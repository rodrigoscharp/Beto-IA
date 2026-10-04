/* Emoção da resposta do chat: o modelo começa toda resposta com `[emo:X]`.
   Aqui ficam a lista, o parse da tag e nada mais; o mascote traduz a emoção em expressão (components/mascot/mapping.ts). */

export const EMOTIONS = [
  "neutro", "alegre", "animado", "pensativo", "bravo", "nervoso", "surpreso", "triste", "sarcastico",
] as const;
export type Emotion = (typeof EMOTIONS)[number];

/* Estado de voz do Beto. */
export type VoiceState = "wake" | "listening" | "thinking" | "speaking";

/* ── Tag de emoção da resposta do chat ───────────────────────────────────── */

/* `[emo:X]`, tolerante a maiúscula, espaço e variação no nome (`[emoção:X]`); uma tag com nome inválido também sai do texto. Global: use só com .replace, nunca com .test. */
export const EMOTION_TAG = /\[\s*emo[^\]:\n]*:?\s*([^\]\n]*?)\s*\]\s*/gi;

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

/* Nome de emoção (qualquer caixa/acento) -> Emotion, ou null se não existir. */
export function emotionFromName(name: string): Emotion | null {
  const key = fold(name);
  return (EMOTIONS as readonly string[]).includes(key) ? (key as Emotion) : null;
}

/* Tira TODAS as tags de emoção do texto e devolve a primeira válida (ou "neutro"). */
export function parseEmotion(reply: string): { emotion: Emotion; text: string } {
  const found: Emotion[] = [];
  const text = reply.replace(EMOTION_TAG, (_m, name: string) => {
    const e = emotionFromName(name);
    if (e) found.push(e);
    return " ";   // espaço, não vazio: "Poxa.[emo:x]Mas" não vira "Poxa.Mas"
  }).replace(/ {2,}/g, " ").trim();
  return { emotion: found[0] ?? "neutro", text };
}
