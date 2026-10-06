import { NextRequest, NextResponse } from "next/server";
import { groqChat } from "@/lib/groq";
import { getGoogleToken, gmailHeader, GmailMessage } from "@/lib/google";
import { getBrasiliaTime } from "@/lib/time";
import { getMyHubContext } from "@/lib/myhub";
import { buildBriefingRequest } from "@/lib/briefing";

/* ── Calendar: events for today ──────────────────────────────────────────── */

async function getTodayEvents(token: string): Promise<string> {
  try {
    const { date } = getBrasiliaTime();
    // Build start/end anchored to Brasília midnight (UTC-3)
    const start = new Date(`${date}T00:00:00-03:00`);
    const end   = new Date(`${date}T23:59:59-03:00`);

    const params = new URLSearchParams({
      timeMin:      start.toISOString(),
      timeMax:      end.toISOString(),
      maxResults:   "10",
      singleEvents: "true",
      orderBy:      "startTime",
    });

    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!res.ok) return "Não consegui acessar o calendário.";
    const data   = await res.json();
    const events = data.items ?? [];
    if (events.length === 0) return "Nenhum evento agendado para hoje.";

    return events.map((e: { summary?: string; start?: { dateTime?: string } }) => {
      const title = e.summary ?? "Sem título";
      if (!e.start?.dateTime) return title;
      const time  = new Date(e.start.dateTime).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
      return `${title} às ${time}`;
    }).join(", ");
  } catch {
    return "Erro ao buscar calendário.";
  }
}

/* ── Gmail: unread emails — real metadata only, classified by LLM ────────── */

function extractSender(from: string): string {
  const named = from.match(/^"?([^"<]+)"?\s*</);
  if (named) return named[1].trim();
  return from.split("@")[0] || from;
}

function formatDate(rawDate: string): string {
  if (!rawDate) return "";
  try {
    const d   = new Date(rawDate);
    if (isNaN(d.getTime())) return "";
    const now     = new Date();
    const diffDays = Math.round(
      (new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() -
       new Date(d.getFullYear(),  d.getMonth(),  d.getDate()).getTime()) / 86_400_000
    );
    const time = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    if (diffDays === 0) return `hoje às ${time}`;
    if (diffDays === 1) return `ontem às ${time}`;
    return d.toLocaleDateString("pt-BR", { weekday: "short", day: "numeric", month: "short" });
  } catch { return ""; }
}

async function getUnreadEmails(token: string): Promise<string> {
  try {
    const listRes = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages?q=is:unread+in:inbox&maxResults=10",
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!listRes.ok) return "Sem acesso ao Gmail.";
    const listData = await listRes.json();
    const messages: { id: string }[] = listData.messages ?? [];
    if (messages.length === 0) return "Nenhum email não lido.";

    const details: GmailMessage[] = await Promise.all(
      messages.slice(0, 8).map(async ({ id }) => {
        const r = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        return r.ok ? r.json() : { id, threadId: id };
      })
    );

    const items = details.map(msg => {
      const sender  = extractSender(gmailHeader(msg, "From"));
      const subject = gmailHeader(msg, "Subject") || "(sem assunto)";
      const date    = formatDate(gmailHeader(msg, "Date"));
      return `${sender}: "${subject}"${date ? ` (${date})` : ""}`;
    }).join("; ");

    return `${messages.length} não lidos — ${items}`;
  } catch {
    return "Erro ao buscar emails.";
  }
}

/* ── Weather (optional) ──────────────────────────────────────────────────── */

async function getWeather(): Promise<string> {
  const key  = process.env.OPENWEATHER_API_KEY;
  const city = process.env.OPENWEATHER_CITY ?? "São Paulo";
  if (!key) return "";

  try {
    const res = await fetch(
      `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${key}&units=metric&lang=pt_br`
    );
    if (!res.ok) return "";
    const data = await res.json();
    return `${Math.round(data.main?.temp ?? 0)}°C e ${data.weather?.[0]?.description ?? ""} em ${city}`;
  } catch {
    return "";
  }
}

/* ── GET /api/briefing ───────────────────────────────────────────────────── */

export async function GET(req: NextRequest) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "GROQ_API_KEY não configurada" }, { status: 500 });

  const token = await getGoogleToken(req);

  const [events, emails, weather, myhub] = await Promise.all([
    token ? getTodayEvents(token) : Promise.resolve("Calendário não conectado."),
    token ? getUnreadEmails(token) : Promise.resolve("Gmail não conectado."),
    getWeather(),
    getMyHubContext(),
  ]);

  const { dateLabel, time, period } = getBrasiliaTime();

  try {
    const text = await groqChat(apiKey, buildBriefingRequest({ dateLabel, time, period, events, emails, weather, myhub }) as never);

    const briefing = text || "Não consegui montar o briefing.";
    return NextResponse.json({ briefing });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro desconhecido";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
