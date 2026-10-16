import { NextRequest, NextResponse } from "next/server";
import { saveSpotifyRefreshToken } from "@/lib/secrets";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const error = req.nextUrl.searchParams.get("error");

  if (error || !code) {
    return NextResponse.redirect(new URL("/?spotify=error", req.url));
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID!;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET!;
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI!;

  const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!tokenRes.ok) {
    return NextResponse.redirect(new URL("/?spotify=error", req.url));
  }

  const data = await tokenRes.json();
  // O endereço local do Safari não recebe o cookie sp_rt: guarda o refresh token cifrado no servidor.
  if (data.refresh_token) await saveSpotifyRefreshToken(data.refresh_token);
  const response = NextResponse.redirect(new URL("/?spotify=ok", req.url));

  response.cookies.set("sp_at", data.access_token, {
    httpOnly: true,
    path: "/",
    maxAge: data.expires_in,
    sameSite: "lax",
  });
  response.cookies.set("sp_rt", data.refresh_token, {
    httpOnly: true,
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
    sameSite: "lax",
  });

  return response;
}
