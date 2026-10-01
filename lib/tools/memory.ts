/* Ferramentas de memória para o modelo (guardar, listar, esquecer). A memória é PERSISTENTE e vai para todo prompt
   futuro, então o servidor impõe, sem confiar no modelo:
   - guardar só se o chefe PEDIU (saveIntent) e no máximo 3 por mensagem; texto numa linha, até 300 caracteres,
     sem duplicar o que já existe (texto normalizado igual ou contido);
   - esquecer só se o chefe PEDIU (forgetIntent), por palavras do conteúdo (nunca por id), no máximo UMA por mensagem;
     ambíguo devolve as opções sem apagar, e palavras genéricas ("tudo", "isso") nunca apagam nada;
   - listar é só leitura. */

import type { ToolDef } from "./calendar";

export interface MemoryRow { id: string; content: string; category?: string; created_at?: string }
export interface MemoryApi {
  list(limit: number): Promise<MemoryRow[]>;
  save(content: string, category: string): Promise<{ ok: boolean; error?: string }>;
  remove(id: string): Promise<{ ok: boolean }>;
}

export interface MemoryCtx {
  api: MemoryApi | null;
  saveIntent: boolean;     // o chefe pediu para guardar/lembrar (wantsMemorySave)
  forgetIntent: boolean;   // o chefe pediu para esquecer (wantsMemoryForget)
  state: { saves: number; forgets: number; changed?: boolean };
}

export const MEMORY_TOOLS: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "memory_save",
      description: "Guarda um fato permanente sobre o chefe, SÓ quando ele pediu para lembrar ou guardar. Uma frase curta e objetiva.",
      parameters: {
        type: "object",
        properties: {
          content: { type: "string", description: "O que guardar, em uma frase (até 300 caracteres)" },
          category: { type: "string", enum: ["preference", "fact", "habit", "task", "other"] },
        },
        required: ["content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "memory_list",
      description: "Lista o que está guardado sobre o chefe, com filtro opcional por palavras.",
      parameters: { type: "object", properties: { query: { type: "string", description: "Palavras para filtrar (opcional)" } } },
    },
  },
  {
    type: "function",
    function: {
      name: "memory_forget",
      description: "Apaga UMA memória, só quando o chefe pediu para esquecer. Passe palavras do conteúdo dela. Se vierem várias opções, pergunte qual.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "Palavras do que esquecer" } },
        required: ["query"],
      },
    },
  },
];

const CATEGORIES = new Set(["preference", "fact", "habit", "task", "other"]);
const MAX_SAVES = 3;
const MAX_CONTENT = 300;
const MIN_CONTENT = 3;
const MIN_CONTAIN = 8;   // abaixo disso, "contido no outro" não prova que é a mesma memória
const SCAN = 200;
const LIST_MAX = 40;
const GENERIC = new Set(["tudo", "todas", "todos", "isso", "disso", "essa", "esse", "memoria", "memorias", "que", "de", "da", "do", "das", "dos",
  "eu", "minha", "meu", "sobre", "para", "com", "uma", "um", "voce", "lembrar", "esquecer", "guardado", "mim"]);

type Args = Record<string, unknown>;
const fail = (error: string) => ({ error });
const isObj = (a: unknown): a is Args => !!a && typeof a === "object" && !Array.isArray(a);

function norm(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function tokens(q: string): string[] {
  return norm(q).split(" ").filter((t) => t.length >= 3 && !GENERIC.has(t));
}
const hasWord = (hay: string, w: string) => ` ${hay} `.includes(` ${w} `);

export async function executeMemoryTool(name: string, args: unknown, ctx: MemoryCtx): Promise<unknown> {
  if (!ctx.api) return fail("A memória não está configurada.");
  if (name !== "memory_save" && name !== "memory_list" && name !== "memory_forget") return fail(`Ferramenta desconhecida: ${name}.`);
  if (!isObj(args)) return fail("Os argumentos precisam ser um objeto.");
  const api = ctx.api;

  if (name === "memory_list") {
    const rows = await api.list(SCAN);
    const toks = typeof args.query === "string" ? tokens(args.query) : [];
    const hit = rows.filter((r) => !toks.length || toks.every((t) => hasWord(norm(r.content), t))).slice(0, LIST_MAX);
    if (!hit.length) return { status: "ok", count: 0, memories: [], message: "Não há nada guardado" + (toks.length ? " sobre isso." : ".") };
    return { status: "ok", count: hit.length, memories: hit.map((r) => ({ content: r.content, category: r.category ?? "other", date: (r.created_at ?? "").slice(0, 10) })) };
  }

  if (name === "memory_save") {
    if (!ctx.saveIntent) return fail("O chefe não pediu para guardar nada agora.");
    const raw = typeof args.content === "string" ? args.content.replace(/\s+/g, " ").trim() : "";
    if (raw.length < MIN_CONTENT) return fail("content vazio ou curto demais: escreva o que guardar em uma frase.");
    if (raw.length > MAX_CONTENT) return fail(`content passa de ${MAX_CONTENT} caracteres: resuma em uma frase.`);
    if (ctx.state.saves >= MAX_SAVES) return fail("Já guardei três memórias nesta mensagem; não guardo mais.");
    const category = typeof args.category === "string" && CATEGORIES.has(args.category) ? args.category : "other";
    const n = norm(raw);
    const known = (await api.list(SCAN)).some((r) => {
      const o = norm(r.content);
      return o === n || (Math.min(o.length, n.length) >= MIN_CONTAIN && (o.includes(n) || n.includes(o)));
    });
    if (known) return { status: "already_known", message: "Isso já está guardado." };
    const r = await api.save(raw, category);
    if (!r.ok) return { status: "failed", error: "Não consegui guardar agora." };
    ctx.state.saves++;
    ctx.state.changed = true;
    return { status: "saved", content: raw };
  }

  // memory_forget
  if (!ctx.forgetIntent) return fail("O chefe não pediu para esquecer nada agora.");
  if (ctx.state.forgets >= 1) return fail("Só esqueço uma memória por mensagem.");
  const toks = typeof args.query === "string" ? tokens(args.query) : [];
  if (!toks.length) return fail("query sem palavra específica: diga palavras do que esquecer (nunca 'tudo').");
  const hit = (await api.list(SCAN)).filter((r) => toks.every((t) => hasWord(norm(r.content), t)));
  if (!hit.length) return { status: "not_found", message: "Não achei nada guardado com essas palavras." };
  if (hit.length > 1) return { status: "needs_choice", message: "Achei mais de uma; pergunte ao chefe qual esquecer.", options: hit.slice(0, 5).map((r) => r.content) };
  const r = await api.remove(hit[0].id);
  if (!r.ok) return { status: "failed", error: "Não consegui apagar agora." };
  ctx.state.forgets++;
  ctx.state.changed = true;
  return { status: "forgotten", content: hit[0].content };
}
