import { groqCompleteOn } from "./groq";
import type { ChatMsg } from "./intent";

/* Pesquisa na web: o browser_search da Groq só existe no gpt-oss, então a lista é própria (não a PREFERRED do chat).
   Tenta o 120b e, se ele falhar ou voltar vazio, o 20b. */
export const WEB_MODELS = ["openai/gpt-oss-120b", "openai/gpt-oss-20b"];

export const WEB_FAIL_TEXT = "[emo:triste] Não consegui pesquisar agora. Tenta de novo daqui a pouco.";

export interface WebResult { text: string; model: string | null; ok: boolean }
export type CallFn = (apiKey: string, model: string, params: unknown) => Promise<{ content: string }>;

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

const defaultCall: CallFn = (apiKey, model, params) => groqCompleteOn(apiKey, model, params as never);

export async function webAnswer(apiKey: string, system: string, messages: ChatMsg[], call: CallFn = defaultCall): Promise<WebResult> {
  const params = {
    messages: [{ role: "system", content: system }, ...messages],
    tools: [{ type: "browser_search" }],
    tool_choice: "required",
    reasoning_effort: "low",
    temperature: 0.3,
    max_tokens: 900,
  };
  for (const model of WEB_MODELS) {
    try {
      const text = cleanCitations((await call(apiKey, model, params)).content ?? "");
      if (text) return { text, model, ok: true };
      console.error("[Beto API] web:", model, "resposta vazia depois da limpeza");
    } catch (e) {
      console.error("[Beto API] web:", model, e);
    }
  }
  return { text: WEB_FAIL_TEXT, model: null, ok: false };
}
