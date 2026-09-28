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

/** Chamado no callback do OAuth do Google. Melhor esforço: falhar aqui não pode quebrar o login. */
export async function saveGoogleRefreshToken(rt: string): Promise<boolean> {
  try {
    const value = encrypt(rt);
    if (!value) return false;
    const { error } = await supabase.from("push_secrets").upsert({ name: GOOGLE_RT, value, updated_at: new Date().toISOString() });
    if (error) console.warn("[Beto] não guardou o refresh token:", error.message);
    return !error;
  } catch (e) {
    console.warn("[Beto] não guardou o refresh token:", e instanceof Error ? e.message : e);
    return false;
  }
}

export async function loadGoogleRefreshToken(): Promise<string | null> {
  try {
    const { data } = await supabase.from("push_secrets").select("value").eq("name", GOOGLE_RT).maybeSingle();
    return data?.value ? decrypt(data.value as string) : null;
  } catch { return null; }
}
