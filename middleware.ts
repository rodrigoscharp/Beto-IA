import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME, verifySession } from "@/lib/auth";

export async function middleware(req: NextRequest) {
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
    "/((?!_next/static|_next/image|login|preview-face|api/auth|api/cron/|manifest\\.webmanifest|sw\\.js|offline\\.html|icons/|favicon\\.ico|icon\\.svg|icon\\.png|apple-icon\\.png).*)",
  ],
};
