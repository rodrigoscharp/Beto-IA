/* Single-password auth. Web Crypto only, so it runs in middleware (edge) and routes (node). */

export const COOKIE_NAME = "beto_auth";
export const SESSION_SECONDS = 60 * 60 * 24 * 30;

// SHA-256 of the access password. Plain text never lives in the repo.
const PASSWORD_SHA256 =
  "33709ba596045483f13ba253a1adba4fa8e8e1d3927346ce36eadc7c7195198e";

const enc = new TextEncoder();

const toHex = (buf: ArrayBuffer) =>
  Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

async function sha256Hex(text: string) {
  return toHex(await crypto.subtle.digest("SHA-256", enc.encode(text)));
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyPassword(input: string) {
  return safeEqual(await sha256Hex(input), PASSWORD_SHA256);
}

/* Serviço local de voz: fala com /api/chat por token (ele não tem o cookie do navegador). Só esse caminho, só com
   VOICE_SERVICE_TOKEN definido e com pelo menos 16 chars (um token curto demais vale como nenhum). */
export const VOICE_TOKEN_PATHS = new Set(["/api/chat"]);

export function voiceTokenOk(authHeader: string | null, pathname: string, token: string | undefined): boolean {
  if (!token || token.length < 16) return false;
  if (!VOICE_TOKEN_PATHS.has(pathname)) return false;
  const m = /^Bearer\s+(\S+)$/i.exec(authHeader ?? "");
  return !!m && safeEqual(m[1], token);
}

/* AUTH_SECRET é obrigatório em produção. O hash da senha está neste repositório (público): usá-lo como chave
   deixaria qualquer um forjar um cookie de sessão válido. O fallback existe só para rodar em desenvolvimento. */
function signingSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") throw new Error("AUTH_SECRET não configurado.");
  return PASSWORD_SHA256;
}

async function hmac(payload: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(signingSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(await crypto.subtle.sign("HMAC", key, enc.encode(payload)));
}

export async function signSession() {
  const expiry = String(Math.floor(Date.now() / 1000) + SESSION_SECONDS);
  return `${expiry}.${await hmac(expiry)}`;
}

export async function verifySession(token: string | undefined) {
  if (!token) return false;
  const [expiry, sig] = token.split(".");
  if (!expiry || !sig) return false;
  if (Number(expiry) < Date.now() / 1000) return false;
  try { return safeEqual(sig, await hmac(expiry)); }
  catch { return false; } // sem AUTH_SECRET em produção: recusa tudo em vez de aceitar chave pública
}
