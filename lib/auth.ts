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

async function hmac(payload: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(process.env.AUTH_SECRET ?? PASSWORD_SHA256),
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
  return safeEqual(sig, await hmac(expiry));
}
