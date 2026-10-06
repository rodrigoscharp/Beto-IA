/* Fim de fala no reconhecimento do navegador: quanto silêncio esperar antes de mandar a frase ao Beto.
   Antes era 700ms fixo, e qualquer hesitação ("é, eu...", "aí ele...") fechava o turno no meio da frase.
   Agora o respiro depende de como a frase termina: pendurada num conectivo, espera bem mais. Puro: testável. */

/** Silêncio para frase que parece completa. */
const BASE_MS = 1400;
/** Fala curtinha (até 2 palavras): provavelmente é o começo. */
const SHORT_MS = 2200;
/** Termina em conectivo, hesitação ou vírgula: ele ainda vai continuar. */
const HANGING_MS = 2800;
/** Teto de uma fala só, para o microfone nunca ficar aberto para sempre. */
export const MAX_UTTERANCE_MS = 60_000;

const HANGING = new Set([
  "e", "é", "ou", "mas", "que", "porque", "pq", "então", "entao", "tipo", "aí", "ai", "daí", "dai", "né", "ne",
  "o", "a", "os", "as", "um", "uma", "de", "do", "da", "dos", "das", "no", "na", "em", "pra", "para", "pro", "com",
  "se", "quando", "como", "onde", "qual", "quais", "eu", "ele", "ela", "meu", "minha", "seu", "sua", "assim",
  "hum", "hm", "ahn", "ah", "eh", "uh", "tá", "ta", "bom", "olha", "veja", "sabe", "tipo",
]);

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
const HANGING_NORM = new Set(Array.from(HANGING, norm));

export function silenceMs(text: string): number {
  const t = text.trim();
  if (/[,;:]$|\.\.\.$|…$/.test(t)) return HANGING_MS;
  const words = norm(t).replace(/[.!?]+$/, "").split(/\s+/).filter(Boolean);
  if (words.length && HANGING_NORM.has(words[words.length - 1])) return HANGING_MS;
  if (words.length <= 2) return SHORT_MS;
  return BASE_MS;
}

/** O que veio depois do nome do Beto na mesma fala ("ei beto, me fala a agenda" → "me fala a agenda"). */
export function afterWake(transcript: string, wakeWords: string[]): string {
  const lower = transcript.toLowerCase();
  let end = -1;
  for (const w of wakeWords) {
    const i = lower.indexOf(w);
    if (i >= 0) end = Math.max(end, i + w.length);
  }
  if (end < 0) return "";
  return transcript.slice(end).replace(/^[\s,.!?:;-]+/, "").trim();
}
