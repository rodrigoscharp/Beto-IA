import { NextRequest } from "next/server";
import { loadGoogleRefreshToken } from "@/lib/secrets";

/* ── Types ───────────────────────────────────────────────────────────────── */

export interface GmailHeader  { name: string; value: string }
export interface GmailMessage {
  id:       string;
  threadId: string;
  snippet?: string;
  payload?: { headers?: GmailHeader[] };
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */

export function gmailHeader(msg: GmailMessage, name: string): string {
  return (
    msg.payload?.headers
      ?.find(h => h.name.toLowerCase() === name.toLowerCase())
      ?.value ?? ""
  );
}

export function extractSender(from: string): string {
  const named = from.match(/^"?([^"<]+)"?\s*</);
  if (named) return named[1].trim();
  return from.split("@")[0] || from;
}

export function googleFetch(token: string, url: string, opts?: RequestInit) {
  return fetch(url, {
    ...opts,
    headers: {
      Authorization:  `Bearer ${token}`,
      "Content-Type": "application/json",
      ...opts?.headers,
    },
  });
}

/* ── Token: reads gc_at cookie, refreshes via gc_rt if needed ───────────── */

// Access token renovado via refresh token: reaproveita por 45 min (o polling de avisos chama a cada 2 min).
let refreshed: { rt: string; token: string; exp: number } | null = null;

export async function refreshAccessToken(rt: string): Promise<string | null> {
  if (refreshed && refreshed.rt === rt && refreshed.exp > Date.now()) return refreshed.token;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:    new URLSearchParams({
      refresh_token: rt,
      client_id:     process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      grant_type:    "refresh_token",
    }),
  });

  if (!res.ok) return null;
  const data = await res.json();
  if (data.access_token) refreshed = { rt, token: data.access_token, exp: Date.now() + 45 * 60 * 1000 };
  return data.access_token ?? null;
}

export async function getGoogleToken(req: NextRequest): Promise<string | null> {
  const at = req.cookies.get("gc_at")?.value;
  if (at) return at;

  const rt = req.cookies.get("gc_rt")?.value;
  return rt ? refreshAccessToken(rt) : null;
}

/** Sem navegador (cron de push): refresh token da env ou o guardado (criptografado) no Supabase no login do Google. */
export async function getServerGoogleToken(): Promise<string | null> {
  const rt = process.env.GOOGLE_REFRESH_TOKEN ?? await loadGoogleRefreshToken();
  return rt ? refreshAccessToken(rt) : null;
}
