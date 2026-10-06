/* Pedido ao modelo para o briefing do dia. Puro, sem imports de runtime: testável.
   O modelo só pode falar do que veio aqui (agenda, emails, clima e My Hub). Dia vazio é dito como vazio. */
import type { MyHubContext } from "./myhub";

export interface BriefingInput {
  dateLabel: string;
  time: string;
  period: string;
  events: string;
  emails: string;
  weather: string;
  myhub: MyHubContext | null;
}

const MYHUB_MAX = 3000;   // o briefing é curto: um pedaço do My Hub basta, e o prompt nunca estoura o modelo

function myHubLine(ctx: MyHubContext | null): string {
  if (!ctx) return "My Hub: não consegui ver agora.";
  const raw = JSON.stringify({ entrevistasProximas: ctx.entrevistasProximas, ...ctx.topicos });
  const dados = raw.length > MYHUB_MAX ? `${raw.slice(0, MYHUB_MAX)}…(cortado)` : raw;
  const faltou = ctx.indisponiveis.length ? ` (não carregou: ${ctx.indisponiveis.join(", ")})` : "";
  return `My Hub (tarefas, projetos, hábitos, metas, entrevistas)${faltou}: ${dados}`;
}

const SYSTEM = "Você é o Beto, braço direito e sócio do Rodrigo, que é o seu chefe (chame-o de chefe com naturalidade). Gere um briefing matinal falado, curto e direto, usando APENAS as informações fornecidas abaixo. Comece com 'Bom dia, chefe!'. Cubra a data, os eventos do dia, o que o My Hub mostra pra hoje (tarefas, projetos, hábitos, entrevistas próximas), os emails (remetente e assunto exatos) e o clima se houver. Máximo 5 frases, texto corrido, sem listas nem markdown. REGRA DURA: NUNCA invente, complete ou suponha nada que não esteja escrito abaixo: nenhuma tarefa, reunião, prazo, backlog ou pendência que não conste. Se uma parte veio vazia, diga que não tem nada registrado nela ('hoje não tem nada registrado na agenda nem no My Hub'); dia vazio é dia vazio, não preencha com sugestões. Assunto de email é email, não tarefa dele. Se uma fonte não foi acessada, diga em poucas palavras que não conseguiu ver.";

export function buildBriefingRequest(input: BriefingInput) {
  const { dateLabel, time, period, events, emails, weather, myhub } = input;
  const context = [
    `Data: ${dateLabel} — ${time}h (${period}, Brasília)`,
    `Agenda de hoje: ${events}`,
    myHubLine(myhub),
    `Emails não lidos: ${emails}`,
    weather ? `Clima: ${weather}` : null,
  ].filter(Boolean).join("\n");
  return {
    messages: [{ role: "system", content: SYSTEM }, { role: "user", content: context }],
    temperature: 0.3,
    max_tokens: 600,
  };
}
