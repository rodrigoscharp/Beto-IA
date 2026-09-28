import { googleFetch } from "@/lib/google";
import { Alert, Collected, HOUR_MS } from "./types";

export interface CalEvent {
  id:      string;
  title:   string;
  startMs: number;
  endMs:   number;
}

const REMIND_WITHIN_MIN = 10;

const brt = (ms: number) => new Date(ms - 3 * HOUR_MS);
const pad = (n: number) => String(n).padStart(2, "0");

function whenLabel(startMs: number, nowMs: number): string {
  const s = brt(startMs), n = brt(nowMs);
  const sameDay = s.getUTCDate() === n.getUTCDate() && s.getUTCMonth() === n.getUTCMonth();
  return `${sameDay ? "hoje" : "amanhã"} às ${s.getUTCHours()}${s.getUTCMinutes() ? ":" + pad(s.getUTCMinutes()) : " horas"}`;
}

/** Pura: lembretes de "já vai começar" e conflitos de horário. */
export function agendaAlerts(events: CalEvent[], nowMs: number): Alert[] {
  const out: Alert[] = [];

  for (const e of events) {
    const min = Math.ceil((e.startMs - nowMs) / 60_000);
    if (min > 0 && min <= REMIND_WITHIN_MIN) {
      out.push({
        id: `agenda:${e.id}:${e.startMs}`,
        source: "agenda",
        text: `Rodrigo, ${e.title} começa em ${min} ${min === 1 ? "minuto" : "minutos"}.`,
        priority: 1,
        until: e.startMs,
      });
    }
  }

  const sorted = [...events].sort((a, b) => a.startMs - b.startMs);
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i], b = sorted[j];
      if (b.startMs >= a.endMs) break;
      if (b.startMs <= nowMs) continue; // os dois já começaram: não adianta avisar
      out.push({
        id: `agenda:conflito:${a.id}:${b.id}:${a.startMs}`,
        source: "agenda",
        text: `Atenção, conflito na agenda ${whenLabel(b.startMs, nowMs)}: ${a.title} e ${b.title} se sobrepõem.`,
        priority: 0,
        until: b.startMs,
      });
    }
  }
  // Muitos conflitos de uma vez viram uma metralhadora: os mais próximos primeiro, o resto vem nos próximos polls.
  const reminders = out.filter(a => a.priority === 1);
  const conflicts = out.filter(a => a.priority === 0).slice(0, 2);
  return [...reminders, ...conflicts];
}

export async function collectAgenda(token: string): Promise<Collected> {
  const now = Date.now();
  const params = new URLSearchParams({
    timeMin: new Date(now).toISOString(),
    timeMax: new Date(now + 30 * HOUR_MS).toISOString(),
    maxResults: "25",
    singleEvents: "true",
    orderBy: "startTime",
  });
  const res = await googleFetch(token, `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`);
  if (!res.ok) return { alerts: [], mark: [] };

  const data = await res.json();
  const events: CalEvent[] = (data.items ?? [])
    .filter((e: { status?: string; start?: { dateTime?: string }; attendees?: { self?: boolean; responseStatus?: string }[] }) =>
      e.status !== "cancelled" &&
      !!e.start?.dateTime &&
      !e.attendees?.some(a => a.self && a.responseStatus === "declined"))
    .map((e: { id: string; summary?: string; start: { dateTime: string }; end?: { dateTime?: string } }) => {
      const startMs = new Date(e.start.dateTime).getTime();
      return {
        id: e.id,
        title: e.summary ?? "um compromisso sem título",
        startMs,
        endMs: e.end?.dateTime ? new Date(e.end.dateTime).getTime() : startMs + HOUR_MS,
      };
    });

  return { alerts: agendaAlerts(events, now), mark: [] };
}
