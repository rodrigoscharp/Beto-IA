import { googleFetch } from "../google";
import type { CalendarApi } from "./calendar";
import type { RawEvent } from "../calendar";

/* Calendar de verdade: a API do Google, agenda principal do chefe. O token vem do cookie da sessão (lib/google).
   GOOGLE_CALENDAR_BASE_URL só existe para testar com um servidor falso. */

export class GoogleApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const base = () => `${process.env.GOOGLE_CALENDAR_BASE_URL || "https://www.googleapis.com"}/calendar/v3/calendars/primary`;

async function check(res: Response, what: string): Promise<void> {
  if (res.ok) return;
  let detail = "";
  try { detail = ((await res.json()) as { error?: { message?: string } })?.error?.message ?? ""; } catch { /* sem corpo */ }
  throw new GoogleApiError(`${what}: ${detail || res.status}`, res.status);
}

export function googleCalendarApi(token: string): CalendarApi {
  const url = (path: string, params?: Record<string, string>) => `${base()}${path}${params ? `?${new URLSearchParams(params)}` : ""}`;
  return {
    async list({ timeMin, timeMax, q, max }) {
      const params: Record<string, string> = { timeMin, timeMax, singleEvents: "true", orderBy: "startTime", maxResults: String(max ?? 50) };
      if (q) params.q = q;
      const res = await googleFetch(token, url("/events", params));
      await check(res, "Não consegui ler a agenda");
      return ((await res.json()) as { items?: RawEvent[] }).items ?? [];
    },
    async get(id) {
      const res = await googleFetch(token, url(`/events/${encodeURIComponent(id)}`));
      if (res.status === 404 || res.status === 410) return null;
      await check(res, "Não consegui ler o evento");
      return (await res.json()) as RawEvent;
    },
    async insert(body, { sendUpdates }) {
      const res = await googleFetch(token, url("/events", { sendUpdates }), { method: "POST", body: JSON.stringify(body) });
      await check(res, "Não consegui criar o evento");
      return (await res.json()) as RawEvent;
    },
    async patch(id, body, { sendUpdates }) {
      const res = await googleFetch(token, url(`/events/${encodeURIComponent(id)}`, { sendUpdates }), { method: "PATCH", body: JSON.stringify(body) });
      await check(res, "Não consegui alterar o evento");
      return (await res.json()) as RawEvent;
    },
    async remove(id, { sendUpdates }) {
      const res = await googleFetch(token, url(`/events/${encodeURIComponent(id)}`, { sendUpdates }), { method: "DELETE" });
      if (res.status === 404 || res.status === 410) return;   // já não existe: o resultado é o mesmo
      await check(res, "Não consegui apagar o evento");
    },
  };
}
