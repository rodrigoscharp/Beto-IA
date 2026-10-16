/* Tipo do ack que a rota manda antes do loop de ferramentas (lib/voicewire.ts): o serviço de voz fala uma frase
   curta enquanto a ferramenta roda. Pura: só o tipo ToolSets. */
import type { ToolSets } from "./turnplan";

export type AckKind = "conteudo" | "agenda" | "myhub" | "memoria" | "geral" | "web";

/** Escolhe pelo que vai rodar, na ordem de prioridade: conteúdo, agenda, My Hub, memória. */
export function ackKind(sets: ToolSets): AckKind {
  if (sets.content) return "conteudo";
  if (sets.calendar) return "agenda";
  if (sets.myhub) return "myhub";
  if (sets.memory) return "memoria";
  return "geral";
}
