/* Tipo do ack que a rota manda antes do loop de ferramentas (lib/voicewire.ts): o serviço de voz fala uma frase
   curta enquanto a ferramenta roda. O navegador faz o mesmo sozinho (turnAck + ackPhrase), com o áudio pré-gerado.
   Pura: só intent/turnplan. */
import type { ChatMsg } from "./intent";
import { planTurn, type ToolSets } from "./turnplan";

export type AckKind = "conteudo" | "agenda" | "myhub" | "memoria" | "geral";

/** Escolhe pelo que vai rodar, na ordem de prioridade: conteúdo, agenda, My Hub, memória. */
export function ackKind(sets: ToolSets): AckKind {
  if (sets.content) return "conteudo";
  if (sets.calendar) return "agenda";
  if (sets.myhub) return "myhub";
  if (sets.memory) return "memoria";
  return "geral";
}

/** As mesmas frases do serviço voice/ ([ack] em voice/beto_voice/config.py). Curtas: o áudio fica pronto no cache. */
export const ACK_PHRASES: Record<AckKind, readonly string[]> = {
  conteudo: ["Deixa eu abrir o roteiro.", "Vou pegar o plano."],
  agenda:   ["Deixa eu ver a agenda.", "Só um segundo, olhando a agenda.", "Vou checar a agenda."],
  myhub:    ["Deixa eu ver no My Hub.", "Um instante, abrindo o My Hub."],
  memoria:  ["Deixa eu ver o que guardei.", "Um segundo."],
  geral:    ["Um segundo.", "Deixa eu ver.", "Já vejo isso."],
};

/** Todas as frases, sem repetição: a lista que o navegador pré-gera. */
export const ACK_ALL: string[] = Array.from(new Set(Object.values(ACK_PHRASES).flat()));

/** Frase do tipo em rodízio (`n` é um contador de quem chama), para não repetir sempre a mesma. */
export function ackPhrase(kind: AckKind, n: number): string {
  const list = ACK_PHRASES[kind];
  return list[Math.abs(Math.trunc(n)) % list.length]!;
}

/* O navegador não sabe o que está configurado no servidor: supõe tudo ligado. Errar aqui só troca a frase
   ("Deixa eu ver." em vez de uma específica), nunca a resposta. */
const ALL_ON = { myhubWrite: true, memory: true, content: true };

/** O turno vai rodar ferramenta (o caminho lento, sem stream)? Devolve o tipo da frase, ou null para conversa. */
export function turnAck(messages: ChatMsg[]): AckKind | null {
  const plan = planTurn(messages, ALL_ON);
  return plan.mode === "full" && plan.sets ? ackKind(plan.sets) : null;
}
