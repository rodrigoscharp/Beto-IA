import Groq from "groq-sdk";
import type { ChatMsg } from "./intent";

/* Pesquisa na web: o browser_search da Groq só existe no gpt-oss, então a lista é própria (não a PREFERRED do chat).
   Tenta o 120b e, se ele falhar ou voltar vazio, o 20b. */
export const WEB_MODELS = ["openai/gpt-oss-120b", "openai/gpt-oss-20b"];

export const WEB_FAIL_TEXT = "[emo:triste] Não consegui pesquisar agora. Tenta de novo daqui a pouco.";

export interface WebResult { text: string; model: string | null; ok: boolean }
export type CallFn = (apiKey: string, model: string, params: unknown, timeoutMs: number) => Promise<{ content: string }>;

/* O modelo devolve marcadores de citação (【3†L1-L2】) e às vezes URLs; nada disso pode ir para a voz.
   A tag [emo:X] fica intacta. */
export function cleanCitations(text: string): string {
  return text
    .replace(/【[^】]*】/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +([,.;:!?])/g, "$1")
    .trim();
}

/* Regras de fala para respostas vindas da web. Texto corrido porque entra no prompt de voz. */
export function webGuide(): string {
  return [
    "Você acabou de pesquisar na web para responder. Responda falando, como numa conversa, no tamanho das regras de TAMANHO, sem listas nem markdown.",
    "Cite a fonte pelo nome do site ou do veículo, por exemplo \"segundo o g1\", nunca pela URL.",
    "Quando a data importar, como cotação, placar ou notícia, diga de quando é a informação.",
    "Se a busca não trouxe nada confiável, diga isso em uma frase e não invente.",
    "Nunca leia marcadores de citação nem endereços de site em voz alta.",
  ].join(" ");
}

/* Cliente próprio: o do groq.ts corta em 12 s, e uma busca (pesquisar + ler páginas) leva mais que isso.
   Sem retries do SDK: se um modelo engasgar, passa para o próximo na hora. O prazo é da pesquisa inteira (40 s):
   cada modelo tem no máximo 30 s e o que sobrar do prazo; com menos de 8 s sobrando, nem tenta o próximo. */
export const WEB_DEADLINE_MS = 40_000;
export const WEB_TIMEOUT_MS = 30_000;
export const WEB_MIN_TRY_MS = 8_000;

const defaultCall: CallFn = async (apiKey, model, params, timeoutMs) => {
  const groq = new Groq({ apiKey, maxRetries: 0, timeout: timeoutMs, baseURL: process.env.GROQ_BASE_URL || undefined });
  const res = await groq.chat.completions.create({ ...(params as object), model, stream: false } as never) as Groq.Chat.ChatCompletion;
  const content = (res.choices[0]?.message?.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  return { content };
};

export async function webAnswer(
  apiKey: string, system: string, messages: ChatMsg[], call: CallFn = defaultCall, now: () => number = Date.now,
): Promise<WebResult> {
  const params = {
    messages: [{ role: "system", content: system }, ...messages],
    tools: [{ type: "browser_search" }],
    tool_choice: "required",
    reasoning_effort: "low",
    temperature: 0.3,
    max_tokens: 900,
  };
  const start = now();
  for (let i = 0; i < WEB_MODELS.length; i++) {
    const model = WEB_MODELS[i];
    const left = WEB_DEADLINE_MS - (now() - start);
    if (i > 0 && left < WEB_MIN_TRY_MS) {
      console.error("[Beto API] web: prazo da pesquisa esgotado, não tenta", model);
      break;
    }
    try {
      const text = cleanCitations((await call(apiKey, model, params, Math.min(WEB_TIMEOUT_MS, left))).content ?? "");
      if (text) return { text, model, ok: true };
      console.error("[Beto API] web:", model, "resposta vazia depois da limpeza");
    } catch (e) {
      console.error("[Beto API] web:", model, e);
    }
  }
  return { text: WEB_FAIL_TEXT, model: null, ok: false };
}
