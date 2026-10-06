/* Decisão de rota de um turno: modo do prompt (conversa ou completo) e quais ferramentas nativas vão junto.
   A rota /api/chat e a bateria de avaliação (scripts/eval) usam a MESMA função, para a bateria testar o que
   a produção faz. Pura: quem chama informa o que está configurado. */
import { needsTools, wantsCalendar, wantsContent, wantsMemory, wantsMemoryTopic, wantsMyHubUndo, wantsMyHubWrite, type ChatMsg } from "./intent";

/** content: o My Hub (leitura) está configurado, então dá para buscar os planos de conteúdo. */
export interface TurnEnv { myhubWrite: boolean; memory: boolean; content?: boolean }
export interface ToolSets { calendar: boolean; myhub: boolean; memory: boolean; content?: boolean }
export interface TurnPlan { mode: "chat" | "full"; sets: ToolSets | null }

export function planTurn(messages: ChatMsg[], env: TurnEnv, forceFull = false): TurnPlan {
  const mode = forceFull || needsTools(messages) ? "full" : "chat";
  const wanted: ToolSets = {
    calendar: wantsCalendar(messages),
    myhub: env.myhubWrite && (wantsMyHubWrite(messages) || wantsMyHubUndo(messages)),
    memory: env.memory && (wantsMemory(messages) || wantsMemoryTopic(messages)),
    content: !!env.content && wantsContent(messages),
  };
  // `full` do cliente só força o prompt completo; não liga ferramentas por si.
  const any = wanted.calendar || wanted.myhub || wanted.memory || wanted.content;
  return { mode, sets: mode === "full" && any ? wanted : null };
}
