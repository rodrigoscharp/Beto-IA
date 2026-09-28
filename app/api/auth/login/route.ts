import { NextRequest, NextResponse } from "next/server";
import {
  COOKIE_NAME,
  SESSION_SECONDS,
  signSession,
  verifyPassword,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

const MAX_FAILS = 8;
const WINDOW_MS = 10 * 60 * 1000;
const fails = new Map<string, { n: number; at: number }>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "local";
  const rec = fails.get(ip);
  if (rec && Date.now() - rec.at < WINDOW_MS && rec.n >= MAX_FAILS) {
    return NextResponse.json({ error: "Muitas tentativas. Aguarde." }, { status: 429 });
  }

  let password = "";
  try {
    password = String((await req.json()).password ?? "");
  } catch { /* empty body */ }

  await sleep(400);

  if (!(await verifyPassword(password))) {
    const fresh = rec && Date.now() - rec.at < WINDOW_MS ? rec.n : 0;
    fails.set(ip, { n: fresh + 1, at: Date.now() });
    return NextResponse.json({ error: "Senha incorreta." }, { status: 401 });
  }

  fails.delete(ip);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, await signSession(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_SECONDS,
  });
  return res;
}
