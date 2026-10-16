import { NextRequest, NextResponse } from "next/server";
import { storedGoogleRefreshToken } from "@/lib/google";

export async function GET(req: NextRequest) {
  const at = req.cookies.get("gc_at")?.value;
  const rt = req.cookies.get("gc_rt")?.value;
  // Sem cookie (endereço local do Safari): conectado se o refresh token está guardado no servidor.
  return NextResponse.json({ connected: !!(at || rt || await storedGoogleRefreshToken()) });
}
