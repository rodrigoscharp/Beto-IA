import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/* Uso único: mostra o refresh token do Google desta sessão para você copiar para GOOGLE_REFRESH_TOKEN
   na Vercel (o cron de push não tem navegador). Protegido pelo login do Beto. */
export async function GET(req: NextRequest) {
  const rt = req.cookies.get("gc_rt")?.value;
  if (!rt) {
    return NextResponse.json(
      { error: "Sem refresh token nesta sessão. Abra /api/calendar/login, autorize o Google e volte aqui." },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }
  return NextResponse.json({ refresh_token: rt }, { headers: { "Cache-Control": "no-store" } });
}
