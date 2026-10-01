import Groq from "groq-sdk";
import { ThinkFilter } from "./thinkfilter";
import { HeadGate } from "./headgate";

/* Groq retira modelos e cada conta enxerga um conjunto diferente.
   Tenta os preferidos em ordem (o primeiro que funcionar fica em cache) e
   só consulta a lista de modelos se todos falharem. */
export const PREFERRED = [
  process.env.GROQ_MODEL,
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
  "qwen/qwen3.8-27b",
  "llama-3.3-70b-versatile",
  "meta-llama/llama-4-maverick-17b-128e-instruct",
  "meta-llama/llama-4-scout-17b-16e-instruct",
  "llama-3.1-8b-instant",
].filter(Boolean) as string[];
const NOT_CHAT = /whisper|guard|tts|orpheus|playai|distil|safeguard|allam/i;

type ChatParams = Omit<Parameters<Groq["chat"]["completions"]["create"]>[0], "model" | "stream">;

let working: string | null = null;
export const workingModel = () => working;

const cooldown = new Map<string, number>(); // model -> timestamp até quando pular
/* Modelo que respondeu 404/"não existe": não adianta tentar de novo a cada pergunta (cada tentativa é uma ida e volta
   perdida). Esquecido depois de 6 h, caso a Groq volte a oferecer. Vale por instância da função. */
const DEAD_MS = 6 * 60 * 60 * 1000;
const dead = new Map<string, number>();
const isDead = (model: string) => (dead.get(model) ?? 0) > Date.now();
export const deadModels = () => Array.from(dead.keys()).filter(isDead);

const isModelError = (e: unknown) => {
  const err = e as { status?: number; message?: string };
  return err?.status === 404 || /model_not_found|decommissioned|does not exist/i.test(err?.message ?? "");
};

/*
 * Lista de bloqueio, não de permissão: só a CHAVE ser inválida é motivo pra desistir na hora — tentar
 * os outros 6 modelos com uma chave ruim é perda de tempo garantida. Tudo mais tenta o próximo modelo.
 *
 * Isso existia ao contrário até aqui (uma lista de quais erros "mereciam" cair pro próximo modelo:
 * ocupado, tamanho…), e cada erro novo que a Groq inventa — um 413 de limite baixo num modelo, um 400
 * porque o gpt-oss achou que a tag [MYHUB:{...}] era uma chamada de ferramenta — caía no "senão" e
 * derrubava a conversa inteira mesmo com modelos bons esperando na fila. A lista de bloqueio não tem
 * esse problema: erro que a gente nunca viu antes também pula pro próximo, sem precisar prever o nome dele.
 */
const isFatalError = (e: unknown) => {
  const err = e as { status?: number; message?: string };
  return err?.status === 401 || err?.status === 403 || /invalid.api.key|unauthorized/i.test(err?.message ?? "");
};

// Modelos de raciocínio (gpt-oss) pensam por vários segundos por padrão; "low" mantém a resposta rápida.
const fastFor = (model: string) => (/^openai\/gpt-oss/.test(model) ? { reasoning_effort: "low" } : {});

const newClient = (apiKey: string) =>
  // Sem retries longos do SDK: se um modelo engasgar (429/5xx/timeout), passa pro próximo na hora.
  // GROQ_BASE_URL só existe para testar com um servidor falso.
  new Groq({ apiKey, maxRetries: 0, timeout: 12_000, baseURL: process.env.GROQ_BASE_URL || undefined });

/** Registra por que um modelo falhou (cooldown ou "morto"). Devolve true se o erro é fatal (chave inválida). */
function noteFailure(model: string, e: unknown): boolean {
  if (isFatalError(e)) return true; // chave inválida etc.: os outros 6 modelos vão falhar igual
  if (isModelError(e)) dead.set(model, Date.now() + DEAD_MS);
  else cooldown.set(model, Date.now() + 20_000);
  if (working === model) working = null;
  return false;
}

async function attempt(groq: Groq, params: ChatParams, model: string) {
  const res = await groq.chat.completions.create({ ...params, ...fastFor(model), model, stream: false } as never) as Groq.Chat.ChatCompletion;
  working = model;
  return (res.choices[0]?.message?.content ?? "")
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .trim();
}

/** Percorre a lista de modelos (o que funcionou por último primeiro) até um responder. Mesma regra para texto e ferramentas. */
async function withModels<T>(apiKey: string, call: (groq: Groq, model: string) => Promise<T>): Promise<T> {
  const groq = newClient(apiKey);
  const tried = new Set<string>();
  let lastError: unknown;
  const FAILED = Symbol("failed");

  const run = async (models: string[], ignoreCooldown = false): Promise<T | typeof FAILED> => {
    for (const model of models) {
      if (tried.has(model) || (!ignoreCooldown && ((cooldown.get(model) ?? 0) > Date.now() || isDead(model)))) continue;
      tried.add(model);
      try {
        return await call(groq, model);
      } catch (e) {
        lastError = e;
        if (noteFailure(model, e)) throw e;
      }
    }
    return FAILED;
  };

  const order = [working, ...PREFERRED].filter(Boolean) as string[];
  const first = await run(order);
  if (first !== FAILED) return first;
  // Todos em cooldown por limite de uso: tenta de novo mesmo assim, o limite pode já ter liberado.
  tried.clear();
  const again = await run(order, true);
  if (again !== FAILED) return again;

  try {
    const ids = (await groq.models.list()).data.map((m) => m.id).filter((m) => !NOT_CHAT.test(m));
    const extra = await run(ids);
    if (extra !== FAILED) return extra;
  } catch (e) {
    lastError = e;
  }
  throw lastError;
}

export async function groqChat(apiKey: string, params: ChatParams): Promise<string> {
  return withModels(apiKey, (groq, model) => attempt(groq, params, model));
}

/* Chamada com ferramentas: devolve o texto e/ou as ferramentas que o modelo pediu. Resposta totalmente vazia conta
   como falha do modelo (passa ao próximo). Chamada de ferramenta malformada (400) também cai no próximo. */
export interface CompleteResult {
  content: string;
  toolCalls: { id: string; name: string; arguments: string }[];
  model: string;
}

export async function groqComplete(apiKey: string, params: ChatParams): Promise<CompleteResult> {
  return withModels(apiKey, async (groq, model) => {
    const res = await groq.chat.completions.create({ ...params, ...fastFor(model), model, stream: false } as never) as Groq.Chat.ChatCompletion;
    const msg = res.choices[0]?.message;
    const content = (msg?.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    const toolCalls = (msg?.tool_calls ?? []).map((c) => ({ id: c.id, name: c.function.name, arguments: c.function.arguments ?? "" }));
    if (!content && toolCalls.length === 0) throw new Error(`O modelo ${model} não devolveu nada.`);
    working = model;
    return { content, toolCalls, model };
  });
}

/* Streaming: devolve a resposta em pedaços de texto, com a mesma lista e a mesma troca de modelo. Só troca de
   modelo ENQUANTO nenhum texto de verdade saiu (tag de emoção sozinha não conta, ver HeadGate); depois do primeiro
   pedaço o ouvinte já começou a receber e erro é repassado a quem consome.
   O timeout do SDK só vale até os cabeçalhos chegarem: um modelo que engasga antes do primeiro token ficaria
   parado para sempre, então cada espera por pedaço tem prazo próprio. */
const FIRST_TOKEN_MS = 8_000;
const CHUNK_MS = 15_000;

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout: ${what}`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

export async function* groqChatStream(apiKey: string, params: ChatParams): AsyncGenerator<string, void, void> {
  const groq = newClient(apiKey);
  const order = [working, ...PREFERRED].filter(Boolean) as string[];
  const seen = new Set<string>();
  let lastError: unknown;

  for (const model of order) {
    if (seen.has(model) || (cooldown.get(model) ?? 0) > Date.now() || isDead(model)) continue;
    seen.add(model);
    let started = false;
    let stream: (AsyncIterable<unknown> & { controller?: AbortController }) | null = null;
    try {
      type Delta = AsyncIterable<{ choices?: { delta?: { content?: string | null } }[] }> & { controller?: AbortController };
      const created = (await groq.chat.completions.create({ ...params, ...fastFor(model), model, stream: true } as never)) as unknown as Delta;
      stream = created;
      const iter = created[Symbol.asyncIterator]();
      const filter = new ThinkFilter();
      const gate = new HeadGate();
      let leading = true;   // o texto final começa sem espaço/linha em branco (como o .trim() do caminho sem stream)
      const emit = (piece: string) => {
        if (leading) { piece = piece.trimStart(); if (!piece) return ""; leading = false; }
        return piece;
      };
      const out = (piece: string) => {
        const text = gate.push(piece);
        if (text && !started) { started = true; working = model; }
        return text;
      };
      for (;;) {
        const r = await withTimeout(iter.next(), started ? CHUNK_MS : FIRST_TOKEN_MS, `modelo ${model}`);
        if (r.done) break;
        const raw = r.value.choices?.[0]?.delta?.content;
        if (!raw) continue;
        const text = out(emit(filter.push(raw)));
        if (text) yield text;
      }
      const tail = out(emit(filter.flush()));
      if (tail) yield tail;
      if (started) return;
      lastError = new Error(`O modelo ${model} não devolveu texto.`);
      cooldown.set(model, Date.now() + 20_000);
    } catch (e) {
      try { stream?.controller?.abort(); } catch { /* já encerrado */ }
      if (started) throw e;
      lastError = e;
      if (noteFailure(model, e)) throw e;
    }
  }
  throw lastError ?? new Error("Nenhum modelo respondeu.");
}
