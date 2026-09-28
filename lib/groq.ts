import Groq from "groq-sdk";

/* Groq retira modelos e nem todo modelo listado é acessível na conta.
   Tenta os preferidos em ordem e cai pro próximo em "model_not_found". */
const PREFERRED = [
  "llama-3.3-70b-versatile",
  "openai/gpt-oss-120b",
  "meta-llama/llama-4-maverick-17b-128e-instruct",
  "qwen/qwen3-32b",
  "openai/gpt-oss-20b",
  "meta-llama/llama-4-scout-17b-16e-instruct",
  "llama-3.1-8b-instant",
];
const NOT_CHAT = /whisper|guard|tts|orpheus|playai|distil|safeguard/i;

type ChatParams = Omit<Parameters<Groq["chat"]["completions"]["create"]>[0], "model" | "stream">;

let listed: { ids: string[]; ts: number } | null = null;
let working: string | null = null;

async function availableModels(groq: Groq): Promise<string[]> {
  if (listed && Date.now() - listed.ts < 60 * 60 * 1000) return listed.ids;
  try {
    const ids = (await groq.models.list()).data.map((m) => m.id);
    listed = { ids, ts: Date.now() };
    return ids;
  } catch {
    return listed?.ids ?? [];
  }
}

const isModelError = (e: unknown) => {
  const err = e as { status?: number; message?: string };
  return err?.status === 404 || /model_not_found|decommissioned|does not exist/i.test(err?.message ?? "");
};

export async function groqChat(apiKey: string, params: ChatParams): Promise<string> {
  const groq = new Groq({ apiKey });
  const ids  = await availableModels(groq);

  const ordered = PREFERRED.filter((m) => ids.length === 0 || ids.includes(m));
  const extra   = ids.filter((m) => !PREFERRED.includes(m) && !NOT_CHAT.test(m));
  const candidates = [working, ...ordered, ...extra, ...PREFERRED]
    .filter((m, i, a): m is string => !!m && a.indexOf(m) === i);

  let lastError: unknown;
  for (const model of candidates.slice(0, 8)) {
    try {
      const res = await groq.chat.completions.create({ ...params, model, stream: false });
      working = model;
      return (res.choices[0]?.message?.content ?? "")
        .replace(/<think>[\s\S]*?<\/think>/g, "")
        .trim();
    } catch (e) {
      lastError = e;
      if (!isModelError(e)) throw e;
      if (working === model) working = null;
    }
  }
  throw lastError;
}
