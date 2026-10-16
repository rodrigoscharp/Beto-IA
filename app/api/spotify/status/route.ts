import { NextRequest, NextResponse } from "next/server";
import { loadSpotifyRefreshToken } from "@/lib/secrets";

export async function GET(req: NextRequest) {
  const at = req.cookies.get("sp_at")?.value;
  const rt = req.cookies.get("sp_rt")?.value;
  // Sem cookie (endereço local do Safari): conectado se o refresh token está guardado no servidor.
  return NextResponse.json({ connected: !!(at || rt || await loadSpotifyRefreshToken()) });
}
