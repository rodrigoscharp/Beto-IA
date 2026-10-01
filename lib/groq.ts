import Groq from "groq-sdk";
import { ThinkFilter } from "./thinkfilter";

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

export async function groqChat(apiKey: string, params: ChatParams): Promise<string> {
  const groq = newClient(apiKey);
  const tried = new Set<string>();
  let lastError: unknown;

  const run = async (models: string[], ignoreCooldown = false) => {
    for (const model of models) {
      if (tried.has(model) || (!ignoreCooldown && ((cooldown.get(model) ?? 0) > Date.now() || isDead(model)))) continue;
      tried.add(model);
      try {
        return await attempt(groq, params, model);
      } catch (e) {
        lastError = e;
        if (noteFailure(model, e)) throw e;
      }
    }
    return null;
  };

  const order = [working, ...PREFERRED].filter(Boolean) as string[];
  const first = await run(order);
  if (first !== null) return first;
  // Todos em cooldown por limite de uso: tenta de novo mesmo assim, o limite pode já ter liberado.
  tried.clear();
  const again = await run(order, true);
  if (again !== null) return again;

  try {
    const ids = (await groq.models.list()).data.map((m) => m.id).filter((m) => !NOT_CHAT.test(m));
    const extra = await run(ids);
    if (extra !== null) return extra;
  } catch (e) {
    lastError = e;
  }
  throw lastError;
}


/* Streaming: devolve a resposta em pedaços de texto, com a mesma lista e a mesma troca de modelo. Só troca de
   modelo ENQUANTO nenhum texto saiu (depois do primeiro pedaço o ouvinte já começou a receber). Erro depois
   disso é repassado a quem consome. */
export async function* groqChatStream(apiKey: string, params: ChatParams): AsyncGenerator<string, void, void> {
  const groq = newClient(apiKey);
  const order = [working, ...PREFERRED].filter(Boolean) as string[];
  const seen = new Set<string>();
  let lastError: unknown;

  for (const model of order) {
    if (seen.has(model) || (cooldown.get(model) ?? 0) > Date.now() || isDead(model)) continue;
    seen.add(model);
    let started = false;
    try {
      type Delta = AsyncIterable<{ choices?: { delta?: { content?: string | null } }[] }>;
      const stream = (await groq.chat.completions.create({ ...params, ...fastFor(model), model, stream: true } as never)) as unknown as Delta;
      const filter = new ThinkFilter();
      let leading = true;   // o texto final começa sem espaço/linha em branco (como o .trim() do caminho sem stream)
      const emit = (piece: string) => {
        if (leading) { piece = piece.trimStart(); if (!piece) return ""; leading = false; }
        return piece;
      };
      for await (const chunk of stream) {
        const raw = chunk.choices?.[0]?.delta?.content;
        if (!raw) continue;
        const piece = emit(filter.push(raw));
        if (!piece) continue;
        if (!started) { started = true; working = model; }
        yield piece;
      }
      const tail = emit(filter.flush());
      if (tail) { if (!started) { started = true; working = model; } yield tail; }
      if (started) return;
      lastError = new Error(`O modelo ${model} não devolveu texto.`);
      cooldown.set(model, Date.now() + 20_000);
    } catch (e) {
      if (started) throw e;
      lastError = e;
      if (noteFailure(model, e)) throw e;
    }
  }
  throw lastError ?? new Error("Nenhum modelo respondeu.");
}
