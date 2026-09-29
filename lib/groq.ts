import Groq from "groq-sdk";

/* Groq retira modelos e cada conta enxerga um conjunto diferente.
   Tenta os preferidos em ordem (o primeiro que funcionar fica em cache) e
   só consulta a lista de modelos se todos falharem. */
const PREFERRED = [
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

const isModelError = (e: unknown) => {
  const err = e as { status?: number; message?: string };
  return err?.status === 404 || /model_not_found|decommissioned|does not exist/i.test(err?.message ?? "");
};
const isBusyError = (e: unknown) => {
  const err = e as { status?: number; name?: string; message?: string };
  return err?.status === 429 || (err?.status ?? 0) >= 500 || /timeout|timed out|ECONN|fetch failed/i.test(`${err?.name} ${err?.message}`);
};
/* Prompt maior que o limite DAQUELE modelo (alguns têm janela bem menor que os outros).
   Não é "aquele modelo está ocupado" — é "esse modelo não serve pra esse pedido" — mas o efeito
   prático é o mesmo: pula pro próximo da lista em vez de derrubar a conversa inteira. */
const isTooLargeError = (e: unknown) => {
  const err = e as { status?: number; message?: string };
  return err?.status === 413 || /too large|context_length_exceeded|rate_limit_exceeded.*token/i.test(err?.message ?? "");
};

async function attempt(groq: Groq, params: ChatParams, model: string) {
  // Modelos de raciocínio (gpt-oss) pensam por vários segundos por padrão; "low" mantém a resposta rápida.
  const fast = /^openai\/gpt-oss/.test(model) ? { reasoning_effort: "low" } : {};
  const res = await groq.chat.completions.create({ ...params, ...fast, model, stream: false } as never) as Groq.Chat.ChatCompletion;
  working = model;
  return (res.choices[0]?.message?.content ?? "")
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .trim();
}

export async function groqChat(apiKey: string, params: ChatParams): Promise<string> {
  // Sem retries longos do SDK: se um modelo engasgar (429/5xx/timeout), passa pro próximo na hora.
  const groq = new Groq({ apiKey, maxRetries: 0, timeout: 12_000 });
  const tried = new Set<string>();
  let lastError: unknown;

  const run = async (models: string[], ignoreCooldown = false) => {
    for (const model of models) {
      if (tried.has(model) || (!ignoreCooldown && (cooldown.get(model) ?? 0) > Date.now())) continue;
      tried.add(model);
      try {
        return await attempt(groq, params, model);
      } catch (e) {
        lastError = e;
        if      (isBusyError(e))    cooldown.set(model, Date.now() + 20_000);
        else if (isTooLargeError(e)) cooldown.set(model, Date.now() + 5_000); // pula pro próximo agora; o cooldown é só pra não bater nele de novo na mesma rajada
        else if (!isModelError(e))  throw e; // erro real (chave inválida, etc.): não adianta tentar os outros 6 modelos
        if (working === model) working = null;
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
