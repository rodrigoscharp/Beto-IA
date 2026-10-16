import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { supabase } from "@/lib/supabase";

/* Segredos do servidor guardados no Supabase, criptografados com TOKEN_ENC_KEY (hex de 32 bytes, só na Vercel).
   O banco só vê texto cifrado: quem tiver só a anon key não consegue ler o token do Google. */

const keyBytes = () => {
  const hex = process.env.TOKEN_ENC_KEY;
  if (!hex || hex.length !== 64) return null;
  return Buffer.from(hex, "hex");
};

export function encrypt(plain: string): string | null {
  const key = keyBytes();
  if (!key) return null;
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
}

export function decrypt(blob: string): string | null {
  const key = keyBytes();
  if (!key) return null;
  try {
    const raw = Buffer.from(blob, "base64");
    const d = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
  } catch { return null; }
}

const GOOGLE_RT = "google_refresh_token";
const SPOTIFY_RT = "spotify_refresh_token";

/** Melhor esforço: falhar aqui não pode quebrar o login. */
async function saveSecret(name: string, plain: string): Promise<boolean> {
  try {
    const value = encrypt(plain);
    if (!value) return false;
    const { error } = await supabase.from("push_secrets").upsert({ name, value, updated_at: new Date().toISOString() });
    if (error) console.warn(`[Beto] não guardou ${name}:`, error.message);
    return !error;
  } catch (e) {
    console.warn(`[Beto] não guardou ${name}:`, e instanceof Error ? e.message : e);
    return false;
  }
}

async function loadSecret(name: string): Promise<string | null> {
  try {
    const { data } = await supabase.from("push_secrets").select("value").eq("name", name).maybeSingle();
    return data?.value ? decrypt(data.value as string) : null;
  } catch { return null; }
}

/** Chamado no callback do OAuth do Google. */
export const saveGoogleRefreshToken = (rt: string) => saveSecret(GOOGLE_RT, rt);
export const loadGoogleRefreshToken = () => loadSecret(GOOGLE_RT);

/** Chamado no callback do Spotify e quando o Spotify troca o refresh token: o endereço local do Safari não tem o
    cookie sp_rt e usa este (ver lib/tokens.ts). */
export const saveSpotifyRefreshToken = (rt: string) => saveSecret(SPOTIFY_RT, rt);
export const loadSpotifyRefreshToken = () => loadSecret(SPOTIFY_RT);
