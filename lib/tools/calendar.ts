/* Ferramentas do Calendar para o modelo (chamada de ferramentas nativa).
   A execução usa uma interface `CalendarApi`: em produção é o Google Calendar (lib/tools/googlecalendar.ts), nos
   testes é um Calendar em memória. Erros de uso (data inválida, evento não encontrado) voltam como { error } para o
   modelo corrigir; nada aqui lança por culpa do modelo.

   Regras que o SERVIDOR impõe, sem confiar no modelo:
   - apagar evento, e remarcar evento com convidados, só executam com `ctx.confirmed` (o "sim" do chefe, ver userConfirmed);
   - criar ou remarcar para um horário em conflito não acontece sem `ignore_conflicts`;
   - convidado só recebe aviso quando há convidados e, no caso de alteração, depois da confirmação;
   - só entra convidado cujo email o próprio chefe disse (texto de convite de terceiros não vira convidado). */

import {
  TZ, addMinutes, conflictsFor, epochToLocal, freeSlots, localToEpoch, normalizeEvent, toRfc3339, validDate, validLocal,
  type Ev, type RawEvent,
} from "../calendar";

export interface CalendarApi {
  list(p: { timeMin: string; timeMax: string; q?: string; max?: number }): Promise<RawEvent[]>;
  get(id: string): Promise<RawEvent | null>;
  insert(body: Record<string, unknown>, opts: { sendUpdates: "all" | "none" }): Promise<RawEvent>;
  patch(id: string, body: Record<string, unknown>, opts: { sendUpdates: "all" | "none" }): Promise<RawEvent>;
  remove(id: string, opts: { sendUpdates: "all" | "none" }): Promise<void>;
}

export interface ToolCtx {
  api: CalendarApi | null;       // null: sem login do Google
  nowLocal: string;              // agora em São Paulo, "YYYY-MM-DDTHH:MM"
  confirmed: boolean;            // o chefe acabou de confirmar a ação (userConfirmed)
  userText: string;              // tudo o que o CHEFE falou nesta conversa (só ele; nunca texto de evento ou do modelo)
}

export interface ToolDef {
  type: "function";
  function: { name: string; description: string; parameters: { type: "object"; properties: Record<string, unknown>; required?: string[] } };
}

/* ── Definições (o que o modelo enxerga) ─────────────────────────────────── */

const fn = (name: string, description: string, properties: Record<string, unknown>, required: string[] = []): ToolDef =>
  ({ type: "function", function: { name, description, parameters: { type: "object", properties, ...(required.length ? { required } : {}) } } });

const S = (description: string) => ({ type: "string", description });
const N = (description: string) => ({ type: "number", description });

export const CALENDAR_TOOLS: ToolDef[] = [
  fn("list_events", "Lista eventos da agenda de um período. Sem datas: hoje e os próximos 7 dias. Use também para achar o event_id antes de remarcar ou cancelar.", {
    start: S("Primeiro dia, YYYY-MM-DD"), end: S("Último dia (inclusive), YYYY-MM-DD"), query: S("Texto no título"), max: N("Máximo de eventos (padrão 15)"),
  }),
  fn("find_free_slots", "Acha janelas livres na agenda em um dia ou período, dentro do expediente.", {
    date: S("Um dia, YYYY-MM-DD"), start: S("Primeiro dia, se for período"), end: S("Último dia, se for período"),
    duration_min: N("Duração mínima em minutos (padrão 60)"), from_hour: N("Começo do expediente (padrão 9)"), to_hour: N("Fim do expediente (padrão 18)"),
  }),
  fn("create_event", "Cria um evento. Se houver conflito de horário, NÃO cria e devolve os conflitos: pergunte ao chefe e, se ele quiser mesmo, chame de novo com ignore_conflicts=true.", {
    title: S("Título"), start: S("Início, hora de São Paulo, YYYY-MM-DDTHH:MM"), end: S("Fim, mesmo formato (opcional)"),
    duration_min: N("Duração em minutos se não houver end (padrão 60)"), location: S("Local"), description: S("Descrição"),
    attendees: { type: "array", items: { type: "string" }, description: "Emails dos convidados (só se o chefe pediu)" },
    ignore_conflicts: { type: "boolean", description: "Marcar mesmo com conflito, depois de o chefe confirmar" },
  }, ["title", "start"]),
  fn("update_event", "Remarca ou altera um evento (precisa do event_id: use list_events antes). Evento com convidados exige confirmação do chefe.", {
    event_id: S("Id do evento"), title: S("Novo título"), start: S("Novo início, YYYY-MM-DDTHH:MM (mantém a duração)"), end: S("Novo fim"),
    duration_min: N("Nova duração em minutos"), location: S("Novo local"), description: S("Nova descrição"),
    ignore_conflicts: { type: "boolean", description: "Remarcar mesmo com conflito, depois de o chefe confirmar" },
  }, ["event_id"]),
  fn("delete_event", "Cancela (apaga) um evento (precisa do event_id: use list_events antes). SEMPRE exige o 'sim' do chefe: na primeira chamada devolve needs_confirmation; pergunte e só então chame de novo.", {
    event_id: S("Id do evento"),
  }, ["event_id"]),
];

/* ── Execução ────────────────────────────────────────────────────────────── */

type Args = Record<string, unknown>;
const fail = (error: string) => ({ error });
const isObj = (a: unknown): a is Args => !!a && typeof a === "object" && !Array.isArray(a);
const isStr = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const brief = (e: Ev) => ({ id: e.id, title: e.title, when: e.spoken, start: e.start, end: e.end, all_day: e.allDay, location: e.location, guests: e.attendees });
const nextDay = (date: string) => epochToLocal(localToEpoch(`${date}T12:00`) + 24 * 3_600_000).slice(0, 10);
const addDays = (date: string, n: number) => epochToLocal(localToEpoch(`${date}T12:00`) + n * 24 * 3_600_000).slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((localToEpoch(`${b}T12:00`) - localToEpoch(`${a}T12:00`)) / (24 * 3_600_000));
const when = (start: string, end: string) => normalizeEvent({ id: "", start: { dateTime: toRfc3339(start) }, end: { dateTime: toRfc3339(end) } }).spoken;

function durationArg(v: unknown): number | { error: string } | undefined {
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= 5 && n <= 1440 ? Math.round(n) : { error: "duração inválida: use de 5 a 1440 minutos." };
}

async function eventsBetween(api: CalendarApi, startLocal: string, endLocal: string, extra: { q?: string; max?: number } = {}): Promise<Ev[]> {
  const raw = await api.list({ timeMin: toRfc3339(startLocal), timeMax: toRfc3339(endLocal), ...extra });
  return raw.map(normalizeEvent).sort((a, b) => localToEpoch(a.start) - localToEpoch(b.start));
}

const NEEDS_CONFIRMATION =
  "Peça a confirmação ao chefe em UMA frase curta (diga o título e o horário) e só chame esta ferramenta de novo depois do sim dele. Não diga que já fez.";

export async function executeCalendarTool(name: string, args: unknown, ctx: ToolCtx): Promise<unknown> {
  if (!ctx.api) return { needsLogin: true, error: "O Google Calendar não está conectado." };
  if (!CALENDAR_TOOLS.some((t) => t.function.name === name)) return fail(`Ferramenta desconhecida: ${name}.`);
  if (!isObj(args)) return fail("Os argumentos precisam ser um objeto.");
  const api = ctx.api;
  const today = ctx.nowLocal.slice(0, 10);

  switch (name) {
    case "list_events": {
      const start = args.start === undefined ? today : String(args.start);
      if (!validDate(start)) return fail("start precisa estar no formato YYYY-MM-DD.");
      const end = args.end === undefined ? addDays(start, 6) : String(args.end);
      if (!validDate(end)) return fail("end precisa estar no formato YYYY-MM-DD.");
      if (end < start) return fail("A data de fim é anterior ao início.");
      if (daysBetween(start, end) > 62) return fail("Intervalo grande demais (máximo 62 dias).");
      const max = Math.min(30, Math.max(1, Math.round(Number(args.max) || 15)));
      const q = isStr(args.query) ? args.query.trim() : undefined;
      const all = await eventsBetween(api, `${start}T00:00`, `${nextDay(end)}T00:00`, { q, max: 100 });
      const events = all.slice(0, max).map(brief);
      return { count: all.length, events, ...(all.length > max ? { note: `Mostrando os primeiros ${max} de ${all.length}.` } : {}) };
    }

    case "find_free_slots": {
      const from = isStr(args.date) ? args.date : isStr(args.start) ? args.start : "";
      const to = isStr(args.date) ? args.date : isStr(args.end) ? args.end : from;
      if (!validDate(from) || !validDate(to)) return fail("Informe date (YYYY-MM-DD) ou start e end nesse formato.");
      if (to < from) return fail("A data de fim é anterior ao início.");
      if (daysBetween(from, to) > 14) return fail("Período grande demais (máximo 15 dias).");
      const dur = args.duration_min === undefined ? 60 : durationArg(args.duration_min);
      if (typeof dur === "object") return dur;
      const h1 = args.from_hour === undefined ? 9 : Number(args.from_hour);
      const h2 = args.to_hour === undefined ? 18 : Number(args.to_hour);
      if (!Number.isInteger(h1) || !Number.isInteger(h2) || h1 < 0 || h2 > 24 || h2 <= h1) return fail("from_hour e to_hour inválidos: use horas inteiras, com o fim depois do começo.");
      const events = await eventsBetween(api, `${from}T00:00`, `${nextDay(to)}T00:00`, { max: 250 });
      const slots = freeSlots({ events, fromDate: from, toDate: to, durationMin: dur ?? 60, dayStartHour: h1, dayEndHour: h2, max: 5, nowLocal: ctx.nowLocal })
        .map((s) => ({ start: s.start, end: s.end, when: s.spoken }));
      return { slots, ...(slots.length ? {} : { note: "Nenhum horário livre nesse período." }) };
    }

    case "create_event": {
      if (!isStr(args.title)) return fail("title é obrigatório.");
      if (args.start === undefined) return fail("start é obrigatório (YYYY-MM-DDTHH:MM, hora de São Paulo).");
      const start = String(args.start);
      if (!validLocal(start)) return fail("start precisa estar no formato YYYY-MM-DDTHH:MM (hora de São Paulo).");
      const dur = durationArg(args.duration_min);
      if (typeof dur === "object") return dur;
      let end: string;
      if (args.end !== undefined) {
        end = String(args.end);
        if (!validLocal(end)) return fail("end precisa estar no formato YYYY-MM-DDTHH:MM.");
      } else {
        end = addMinutes(start, dur ?? 60);
      }
      if (localToEpoch(end) <= localToEpoch(start)) return fail("end precisa ser depois de start.");

      let attendees: string[] = [];
      if (args.attendees !== undefined) {
        if (!Array.isArray(args.attendees)) return fail("attendees precisa ser uma lista de emails.");
        if (args.attendees.length > 10) return fail("Máximo de 10 convidados.");
        for (const a of args.attendees) if (typeof a !== "string" || !EMAIL.test(a.trim())) return fail(`email inválido: ${String(a)}`);
        attendees = args.attendees.map((a) => String(a).trim());
        // Títulos e descrições de eventos vêm de convites de terceiros e podem tentar induzir o modelo a convidar alguém
        // (o Google mandaria o convite). Só entra convidado cujo email o próprio chefe disse.
        const said = ctx.userText.toLowerCase();
        const stranger = attendees.find((a) => !said.includes(a.toLowerCase()));
        if (stranger) return fail(`Só convide emails que o chefe falou na conversa; ${stranger} não foi dito por ele. Marque sem esse convidado ou pergunte o email.`);
      }

      if (args.ignore_conflicts !== true) {
        const conflicts = conflictsFor(await eventsBetween(api, start, end), start, end);
        if (conflicts.length) {
          return { status: "conflict", conflicts: conflicts.map(brief), instruction: "Avise o chefe do conflito em uma frase e pergunte se marca mesmo assim. Se ele confirmar, chame create_event de novo com ignore_conflicts=true." };
        }
      }
      const body: Record<string, unknown> = {
        summary: String(args.title).trim(),
        start: { dateTime: `${start.slice(0, 16)}:00`, timeZone: TZ },
        end: { dateTime: `${end.slice(0, 16)}:00`, timeZone: TZ },
      };
      if (isStr(args.location)) body.location = args.location.trim();
      if (isStr(args.description)) body.description = args.description.trim();
      if (attendees.length) body.attendees = attendees.map((email) => ({ email }));
      const created = normalizeEvent(await api.insert(body, { sendUpdates: attendees.length ? "all" : "none" }));
      return { status: "created", id: created.id, title: created.title, when: created.spoken };
    }

    case "update_event": {
      if (!isStr(args.event_id)) return fail("event_id é obrigatório (use list_events para achar).");
      const fields = ["title", "start", "end", "duration_min", "location", "description"];
      if (!fields.some((f) => args[f] !== undefined)) return fail("Nada para mudar: informe title, start, end, duration_min, location ou description.");
      const raw = await api.get(args.event_id.trim());
      if (!raw) return fail("Evento não encontrado.");
      const ev = normalizeEvent(raw);
      const timeChange = args.start !== undefined || args.end !== undefined || args.duration_min !== undefined;
      if (timeChange && ev.allDay) return fail("Evento de dia inteiro: não dá para mudar o horário por aqui.");

      let newStart = ev.start, newEnd = ev.end;
      if (timeChange) {
        if (args.start !== undefined) {
          newStart = String(args.start);
          if (!validLocal(newStart)) return fail("start precisa estar no formato YYYY-MM-DDTHH:MM (hora de São Paulo).");
        }
        const dur = durationArg(args.duration_min);
        if (typeof dur === "object") return dur;
        if (args.end !== undefined) {
          newEnd = String(args.end);
          if (!validLocal(newEnd)) return fail("end precisa estar no formato YYYY-MM-DDTHH:MM.");
        } else {
          const original = Math.round((localToEpoch(ev.end) - localToEpoch(ev.start)) / 60_000);
          newEnd = addMinutes(newStart, dur ?? original);
        }
        if (localToEpoch(newEnd) <= localToEpoch(newStart)) return fail("end precisa ser depois de start.");
        if (args.ignore_conflicts !== true) {
          const conflicts = conflictsFor((await eventsBetween(api, newStart, newEnd)).filter((e) => e.id !== ev.id), newStart, newEnd);
          if (conflicts.length) {
            return { status: "conflict", conflicts: conflicts.map(brief), instruction: "Avise o chefe do conflito e pergunte se remarca mesmo assim. Se ele confirmar, chame update_event de novo com ignore_conflicts=true." };
          }
        }
      }
      if (ev.hasOthers && !ctx.confirmed) {
        return { status: "needs_confirmation", event: brief(ev), change: timeChange ? { new_when: when(newStart, newEnd) } : undefined, instruction: `${NEEDS_CONFIRMATION} O evento tem convidados, que serão avisados.` };
      }
      const body: Record<string, unknown> = {};
      if (isStr(args.title)) body.summary = args.title.trim();
      if (isStr(args.location)) body.location = args.location.trim();
      if (isStr(args.description)) body.description = args.description.trim();
      if (timeChange) {
        body.start = { dateTime: `${newStart.slice(0, 16)}:00`, timeZone: TZ };
        body.end = { dateTime: `${newEnd.slice(0, 16)}:00`, timeZone: TZ };
      }
      const updated = normalizeEvent(await api.patch(ev.id, body, { sendUpdates: ev.hasOthers ? "all" : "none" }));
      return { status: "updated", id: updated.id, title: updated.title, when: updated.spoken };
    }

    case "delete_event": {
      if (!isStr(args.event_id)) return fail("event_id é obrigatório (use list_events para achar).");
      const raw = await api.get(args.event_id.trim());
      if (!raw) return fail("Evento não encontrado.");
      const ev = normalizeEvent(raw);
      if (!ctx.confirmed) {
        return { status: "needs_confirmation", event: brief(ev), instruction: `${NEEDS_CONFIRMATION}${ev.hasOthers ? " O evento tem convidados, que serão avisados do cancelamento." : ""}` };
      }
      await api.remove(ev.id, { sendUpdates: ev.hasOthers ? "all" : "none" });
      return { status: "deleted", title: ev.title, when: ev.spoken };
    }
  }
  return fail(`Ferramenta desconhecida: ${name}.`);
}
