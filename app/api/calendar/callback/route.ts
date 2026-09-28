import { NextRequest, NextResponse } from "next/server";
import { saveGoogleRefreshToken } from "@/lib/secrets";

export async function GET(req: NextRequest) {
  const googleError = req.nextUrl.searchParams.get("error");
  if (googleError) {
    return NextResponse.redirect(new URL(`/?google_error=${encodeURIComponent(googleError)}`, req.url));
  }

  const code = req.nextUrl.searchParams.get("code");
  if (!code) return NextResponse.redirect(new URL("/?google_error=no_code", req.url));

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id:     process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri:  process.env.GOOGLE_REDIRECT_URI ?? `${req.nextUrl.protocol}//${req.nextUrl.host}/api/calendar/callback`,
      grant_type:    "authorization_code",
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = err?.error_description ?? err?.error ?? "token_exchange_failed";
    return NextResponse.redirect(new URL(`/?google_error=${encodeURIComponent(msg)}`, req.url));
  }

  const d = await res.json();
  const isHttps = req.nextUrl.protocol === "https:";
  const response = NextResponse.redirect(new URL("/?calendar=ok", req.url));

  response.cookies.set("gc_at", d.access_token, {
    httpOnly: true, path: "/", maxAge: d.expires_in ?? 3600, sameSite: "lax", secure: isHttps,
  });
  if (d.refresh_token) {
    // O cron de push não tem cookie: guarda o refresh token cifrado no servidor.
    await saveGoogleRefreshToken(d.refresh_token);
    response.cookies.set("gc_rt", d.refresh_token, {
      httpOnly: true, path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax", secure: isHttps,
    });
  }

  return response;
}
