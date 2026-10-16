import { NextRequest } from "next/server";
import { loadSpotifyRefreshToken, saveSpotifyRefreshToken } from "@/lib/secrets";
import { refreshTokenFor } from "@/lib/tokens";

/* ── Types ───────────────────────────────────────────────────────────────── */

export interface SpotifyTokenResult {
  token:      string;
  newToken?:  string;
  expiresIn?: number;
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function basicAuth(): string {
  return Buffer.from(
    `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
  ).toString("base64");
}

export function spotifyFetch(token: string, method: string, path: string, body?: object) {
  return fetch(`https://api.spotify.com/v1${path}`, {
    method,
    headers: {
      Authorization:  `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

export async function spotifyError(res: Response): Promise<string | null> {
  if (res.ok || res.status === 204) return null;
  if (res.status === 403) return "Esse recurso exige Spotify Premium.";
  if (res.status === 404) return "Nenhum dispositivo ativo. Tente novamente.";
  if (res.status === 429) return "Muitas requisições ao Spotify. Aguarde um momento.";
  try {
    const data = await res.json();
    const msg  = (data?.error?.message as string | undefined)?.toLowerCase() ?? "";
    if (msg.includes("no active device")) return "Nenhum dispositivo ativo. Tente novamente.";
    if (msg.includes("premium"))          return "Esse recurso exige Spotify Premium.";
  } catch { /* ignore */ }
  return `Erro do Spotify (${res.status}).`;
}

/* ── Token: reads sp_at cookie, refreshes via sp_rt (or the stored one) if needed ── */

export async function getSpotifyToken(req: NextRequest): Promise<SpotifyTokenResult | null> {
  const at = req.cookies.get("sp_at")?.value;
  if (at) return { token: at };

  // Sem cookie (endereço local do Safari): o refresh token guardado no servidor.
  const rt = await refreshTokenFor(req.cookies.get("sp_rt")?.value, loadSpotifyRefreshToken);
  if (!rt) return null;

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method:  "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization:  `Basic ${basicAuth()}`,
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: rt }),
  });

  if (!res.ok) return null;
  const data = await res.json();
  // O Spotify às vezes troca o refresh token: guarda o novo, senão o do servidor para de valer.
  if (data.refresh_token && data.refresh_token !== rt) await saveSpotifyRefreshToken(data.refresh_token);
  return { token: data.access_token, newToken: data.access_token, expiresIn: data.expires_in };
}
