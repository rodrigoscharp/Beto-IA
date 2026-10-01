/* Calendar: datas em São Paulo, normalização de evento, texto falado, conflito e horário livre.
   Funções puras, sem imports: rodam nas ferramentas do servidor e nos testes.
   Datas "locais" são strings "YYYY-MM-DDTHH:MM" (hora de São Paulo, sem deslocamento). */

export const TZ = "America/Sao_Paulo";
/* São Paulo não tem horário de verão desde 2019: o deslocamento é fixo em -03:00. Se o horário de verão voltar,
   é este o único lugar a mudar (e o Google continua recebendo dateTime + timeZone, que não depende dele). */
const OFFSET_MIN = -180;

const pad = (n: number) => String(n).padStart(2, "0");
const WEEKDAYS = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

export interface RawEvent {
  id?: string; summary?: string; status?: string; transparency?: string; location?: string; hangoutLink?: string;
  organizer?: { email?: string; self?: boolean };
  recurringEventId?: string;            // ocorrência de uma série
  recurrence?: string[];                // evento-mestre de uma série
  start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string };
  attendees?: { email?: string; self?: boolean; resource?: boolean; responseStatus?: string }[];
}

export interface Ev {
  id: string; title: string;
  start: string; end: string;          // locais; em evento de dia inteiro o fim é exclusivo (00:00 do dia seguinte)
  allDay: boolean; location: string | null;
  attendees: number;                   // convidados além de você
  hasOthers: boolean;                  // convidados além de você, ou convite de outro organizador
  recurring: boolean;                  // é UMA ocorrência de uma série (mexer nela só afeta aquele dia)
  series: boolean;                     // é a série inteira (mexer nela afeta todas as ocorrências)
  meetLink: string | null;
  spoken: string;                      // "sexta-feira, 2 de outubro, das 15h às 16h"
  busy: boolean;                       // ocupa o horário: não cancelado, não "livre", não recusado
}

/* ── Datas locais ────────────────────────────────────────────────────────── */

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

export function validDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return mo >= 1 && mo <= 12 && dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

export function validLocal(s: string): boolean {
  const m = LOCAL_RE.exec(s);
  if (!m) return false;
  const [h, mi, se] = [Number(m[4]), Number(m[5]), m[6] === undefined ? 0 : Number(m[6])];
  return validDate(`${m[1]}-${m[2]}-${m[3]}`) && h <= 23 && mi <= 59 && se <= 59;
}

export function localToEpoch(local: string): number {
  const m = LOCAL_RE.exec(local);
  if (!m) return NaN;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])) - OFFSET_MIN * 60_000;
}

export function epochToLocal(ms: number): string {
  const d = new Date(ms + OFFSET_MIN * 60_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** "2026-10-02T15:00" -> "2026-10-02T15:00:00-03:00" (RFC 3339, o que a API do Google espera em timeMin/timeMax). */
export function toRfc3339(local: string): string {
  const sign = OFFSET_MIN < 0 ? "-" : "+";
  const abs = Math.abs(OFFSET_MIN);
  return `${local.slice(0, 16)}:00${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

export function addMinutes(local: string, minutes: number): string {
  return epochToLocal(localToEpoch(local) + minutes * 60_000);
}

/* ── Texto falado ────────────────────────────────────────────────────────── */

function dayLabel(local: string): string {
  const m = LOCAL_RE.exec(local)!;
  const wd = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
  return `${WEEKDAYS[wd]}, ${Number(m[3])} de ${MONTHS[Number(m[2]) - 1]}`;
}

function hourLabel(local: string): string {
  const m = LOCAL_RE.exec(local)!;
  const h = Number(m[4]), mi = Number(m[5]);
  return mi === 0 ? `${h}h` : `${h}h${pad(mi)}`;
}

export function spokenWhen(start: string, end: string, allDay: boolean): string {
  if (allDay) {
    const last = epochToLocal(localToEpoch(end) - 24 * 3_600_000);
    return last.slice(0, 10) === start.slice(0, 10) || localToEpoch(last) < localToEpoch(start)
      ? `${dayLabel(start)}, o dia todo`
      : `de ${dayLabel(start)} até ${dayLabel(last)}`;
  }
  return start.slice(0, 10) === end.slice(0, 10)
    ? `${dayLabel(start)}, das ${hourLabel(start)} às ${hourLabel(end)}`
    : `${dayLabel(start)}, das ${hourLabel(start)} até ${hourLabel(end)} de ${dayLabel(end)}`;
}

/* ── Evento do Google -> o que o Beto usa ────────────────────────────────── */

export function normalizeEvent(raw: RawEvent): Ev {
  const allDay = !raw.start?.dateTime && !!raw.start?.date;
  let start: string, end: string;
  if (allDay) {
    start = `${raw.start!.date}T00:00`;
    end = raw.end?.date ? `${raw.end.date}T00:00` : addMinutes(start, 24 * 60);
  } else {
    start = epochToLocal(Date.parse(raw.start?.dateTime ?? ""));
    end = raw.end?.dateTime ? epochToLocal(Date.parse(raw.end.dateTime)) : addMinutes(start, 60);
  }
  const people = (raw.attendees ?? []).filter((a) => !a.resource);
  const others = people.filter((a) => !a.self).length;
  const declined = people.some((a) => a.self && a.responseStatus === "declined");
  return {
    id: raw.id ?? "",
    title: raw.summary?.trim() || "Sem título",
    start, end, allDay,
    location: raw.location?.trim() || null,
    attendees: others,
    hasOthers: others > 0 || raw.organizer?.self === false,
    recurring: !!raw.recurringEventId,
    series: (raw.recurrence?.length ?? 0) > 0,
    meetLink: raw.hangoutLink ?? null,
    spoken: spokenWhen(start, end, allDay),
    busy: raw.status !== "cancelled" && raw.transparency !== "transparent" && !declined,
  };
}

/** Como normalizeEvent, mas devolve null (em vez de lançar) para evento sem horário válido. */
export function tryNormalize(raw: RawEvent): Ev | null {
  try {
    const e = normalizeEvent(raw);
    return validLocal(e.start) && validLocal(e.end) ? e : null;
  } catch {
    return null;
  }
}

/* ── Conflito e horário livre ────────────────────────────────────────────── */

export function overlaps(a: { start: string; end: string }, b: { start: string; end: string }): boolean {
  return localToEpoch(a.start) < localToEpoch(b.end) && localToEpoch(b.start) < localToEpoch(a.end);
}

/** Eventos que ocupam o horário e batem com [start, end). Dia inteiro (aniversário, feriado) não conta. */
export function conflictsFor(events: Ev[], start: string, end: string): Ev[] {
  return events.filter((e) => e.busy && !e.allDay && overlaps(e, { start, end }));
}

export interface Slot { start: string; end: string; spoken: string }

const MAX_SPAN_DAYS = 31;

export function freeSlots(o: {
  events: Ev[]; fromDate: string; toDate: string; durationMin: number;
  dayStartHour: number; dayEndHour: number; max: number; nowLocal: string;
}): Slot[] {
  if (!validDate(o.fromDate) || !validDate(o.toDate) || o.fromDate > o.toDate) return [];
  if (!(o.durationMin > 0) || !(o.dayEndHour > o.dayStartHour)) return [];
  const busy = o.events.filter((e) => e.busy && !e.allDay).map((e) => [localToEpoch(e.start), localToEpoch(e.end)] as const)
    .sort((a, b) => a[0] - b[0]);
  const now = localToEpoch(o.nowLocal);
  const need = o.durationMin * 60_000;
  const out: Slot[] = [];

  let day = o.fromDate;
  for (let i = 0; i < MAX_SPAN_DAYS && day <= o.toDate && out.length < o.max; i++) {
    // "Agora" arredondado para cima em :00 ou :30 (oferecer "das 14h37" soa estranho).
    const HALF = 30 * 60_000;
    const from = Number.isNaN(now) ? -Infinity : Math.ceil(now / HALF) * HALF;
    const winStart = Math.max(localToEpoch(`${day}T${pad(o.dayStartHour)}:00`), from);
    const winEnd = localToEpoch(`${day}T${pad(o.dayEndHour)}:00`);
    let cursor = winStart;
    const push = (from: number, to: number) => {
      if (to - from >= need && out.length < o.max) {
        const s = epochToLocal(from), e = epochToLocal(to);
        out.push({ start: s, end: e, spoken: spokenWhen(s, e, false) });
      }
    };
    for (const [bs, be] of busy) {
      if (be <= cursor || bs >= winEnd) continue;
      if (bs > cursor) push(cursor, Math.min(bs, winEnd));
      cursor = Math.max(cursor, be);
      if (cursor >= winEnd) break;
    }
    if (cursor < winEnd) push(cursor, winEnd);
    day = epochToLocal(localToEpoch(`${day}T12:00`) + 24 * 3_600_000).slice(0, 10);
  }
  return out;
}
