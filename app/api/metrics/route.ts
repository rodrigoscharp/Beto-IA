import { NextRequest, NextResponse } from "next/server";
import { validMetric } from "@/lib/ops";

export const dynamic = "force-dynamic";

/* Métrica do navegador (tempo até o primeiro áudio). Só número e valores fixos, nunca texto de conversa.
   Aparece nos logs da Vercel como "[beto-metrics]". */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const m = validMetric(body);
  if (!m) return new NextResponse(null, { status: 400 });
  console.log("[beto-metrics]", JSON.stringify(m));
  return new NextResponse(null, { status: 204 });
}
