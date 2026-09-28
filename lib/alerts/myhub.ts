import type { MyHubContext } from "@/lib/myhub";
import { Alert, HOUR_MS } from "./types";

interface Habito { nome: string; feitoHoje: boolean; streakAtual: number }
interface Meta   { titulo: string; progressoPercent: number }
interface Treino { treinoDeHoje: string; diasDesdeUltimo: number | null }

/**
 * Pura: o que o My Hub pede para o Beto dizer agora.
 * Silêncio é o padrão: cada aviso tem janela de horário e dispara uma vez por dia (ou uma vez na vida).
 */
export function myhubAlerts(ctx: MyHubContext, date: string, hour: number, nowMs: number): Alert[] {
  const out: Alert[] = [];
  const endOfDay = nowMs + (24 - hour) * HOUR_MS;
  const t = ctx.topicos as { habitos?: Habito[]; treinos?: Treino; metas?: Meta[] };

  // Hábitos pendentes à noite
  if (hour >= 20 && Array.isArray(t.habitos)) {
    const pend = t.habitos.filter(h => !h.feitoHoje);
    if (pend.length > 0) {
      const nomes = pend.map(h => h.nome);
      const lista = nomes.length > 1 ? `${nomes.slice(0, -1).join(", ")} e ${nomes.at(-1)}` : nomes[0];
      const emRisco = pend.filter(h => h.streakAtual >= 3).sort((a, b) => b.streakAtual - a.streakAtual)[0];
      out.push({
        id: `myhub:habitos:${date}`,
        source: "myhub",
        text: `Rodrigo, ainda faltam hoje: ${lista}.` +
          (emRisco ? ` A sequência de ${emRisco.nome} está em ${emRisco.streakAtual} dias, não deixa quebrar.` : ""),
        priority: 0,
        until: endOfDay,
      });
    }
  }

  // Treino do dia ainda não registrado
  const tr = t.treinos;
  if (hour >= 17 && hour < 22 && tr && tr.diasDesdeUltimo !== 0 && !/nenhuma ficha/i.test(tr.treinoDeHoje)) {
    out.push({
      id: `myhub:treino:${date}`,
      source: "myhub",
      text: `Hoje é dia de ${tr.treinoDeHoje} e você ainda não registrou treino. Bora?`,
      priority: 0,
      until: endOfDay,
    });
  }

  // Meta batida (uma vez na vida)
  if (Array.isArray(t.metas)) {
    for (const m of t.metas) {
      if (m.progressoPercent >= 100) {
        out.push({
          id: `myhub:meta:${m.titulo}`,
          source: "myhub",
          text: `Parabéns Rodrigo! A meta ${m.titulo} chegou a cem por cento.`,
          priority: 0,
          until: nowMs + 12 * HOUR_MS,
        });
      }
    }
  }
  return out;
}
