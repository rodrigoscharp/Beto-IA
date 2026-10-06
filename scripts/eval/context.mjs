/* Monta o pedido à Groq de um caso exatamente como /api/chat monta: mesma decisão de rota (planTurn), mesmo prompt,
   mesmas ferramentas e mesmos parâmetros. Data, memórias e My Hub vêm dos fixtures, para as notas serem comparáveis. */
import { planTurn } from "../../lib/turnplan.ts";
import { buildSystemPrompt } from "../../lib/prompt.ts";
import { myHubPromptBlock } from "../../lib/myhubprompt.ts";
import { CALENDAR_TOOLS } from "../../lib/tools/calendar.ts";
import { MYHUB_TOOLS } from "../../lib/tools/myhub.ts";
import { MEMORY_TOOLS } from "../../lib/tools/memory.ts";
import { CONTENT_TOOLS } from "../../lib/tools/content.ts";

const ENV = { myhubWrite: true, memory: true, content: true };   // em produção tudo está configurado

export const toolNames = () => [...CALENDAR_TOOLS, ...MYHUB_TOOLS, ...MEMORY_TOOLS, ...CONTENT_TOOLS].map((t) => t.function.name);

export function buildRequest(conversa, fx) {
  const plan = planTurn(conversa, ENV);
  const sets = plan.sets ?? { calendar: false, myhub: false, memory: false, content: false };
  const myhub = plan.mode === "full" ? fx.myhub : null;   // a rota só busca o My Hub no modo completo
  const system = buildSystemPrompt({
    memories: fx.memorias,
    myhubBlock: myHubPromptBlock(myhub, fx.agora.date, { writeConfigured: ENV.myhubWrite, tools: sets.myhub }),
    date: fx.agora.date, dateLabel: fx.agora.dateLabel, time: fx.agora.time, period: fx.agora.period,
    calendar: sets.calendar, memory: sets.memory, content: sets.content,
  }, plan.mode);
  const messages = [{ role: "system", content: system }, ...conversa];
  if (!plan.sets) return { plan, params: { messages, temperature: 0.7, max_tokens: 700 } };
  const tools = [...(sets.calendar ? CALENDAR_TOOLS : []), ...(sets.myhub ? MYHUB_TOOLS : []), ...(sets.memory ? MEMORY_TOOLS : []), ...(sets.content ? CONTENT_TOOLS : [])];
  return { plan, params: { messages, tools, tool_choice: "auto", temperature: 0.3, max_tokens: 700 } };
}
