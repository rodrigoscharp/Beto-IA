import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME, verifySession, voiceTokenOk } from "@/lib/auth";

export async function middleware(req: NextRequest) {
  // Serviço local de voz: token de serviço só em /api/chat (ver lib/auth.ts).
  if (voiceTokenOk(req.headers.get("authorization"), req.nextUrl.pathname, process.env.VOICE_SERVICE_TOKEN)) {
    return NextResponse.next();
  }
  if (await verifySession(req.cookies.get(COOKIE_NAME)?.value)) {
    return NextResponse.next();
  }

  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|login|api/auth|api/cron/|manifest\\.webmanifest|sw\\.js|offline\\.html|icons/|favicon\\.ico|icon\\.svg|icon\\.png|apple-icon\\.png).*)",
  ],
};
