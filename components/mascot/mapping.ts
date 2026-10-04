/* Estado do app → expressão do mascote. Funções puras (testadas em scripts/mascot.test.mjs). */

import type { Emotion, VoiceState } from "../../lib/emotion";
import type { MascotEmotion } from "./ghost";

/* As 9 emoções da tag [emo:X] caem nas expressões do Fantasminha. */
export const EMOTION_TO_MASCOT: Record<Emotion, MascotEmotion> = {
  neutro:     "neutro",
  alegre:     "feliz",
  animado:    "feliz",       // + pulinho ao começar a falar (shouldHop)
  pensativo:  "pensando",
  bravo:      "bravo",
  nervoso:    "nervoso",     // surpreso + tremor leve
  surpreso:   "surpreso",
  triste:     "triste",
  sarcastico: "sarcastico",  // neutro com cabeça inclinada e meio sorriso
};

export function mascotEmotion(state: VoiceState, emotion: Emotion, music: boolean): MascotEmotion {
  switch (state) {
    case "wake":      return music ? "dj" : "dormindo";
    case "listening": return "ouvindo";
    case "thinking":  return "pensando";
    case "speaking":  return EMOTION_TO_MASCOT[emotion];
  }
}

/* A boca só mexe com a voz tocando de fato, e só no speaking. */
export const mascotTalking = (state: VoiceState, talking: boolean) => state === "speaking" && talking;

/* "animado" ganha um pulinho quando a fala começa (não a cada re-render). */
export function shouldHop(prev: { state: VoiceState; emotion: Emotion } | null, next: { state: VoiceState; emotion: Emotion }) {
  if (next.state !== "speaking" || next.emotion !== "animado") return false;
  return !prev || prev.state !== "speaking" || prev.emotion !== "animado";
}
