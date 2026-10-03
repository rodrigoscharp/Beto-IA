import { NextRequest, NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/cron-auth";
import { evalReportMessage, validEvalReport } from "@/lib/ops";
import { pushConfigured, sendToAll } from "@/lib/push";

export const dynamic = "force-dynamic";

/* Chamada pelo GitHub Actions (eval-nightly.yml) quando a avaliação noturna cai ou não roda: avisa por push. */
export async function POST(req: NextRequest) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const r = validEvalReport(await req.json().catch(() => null));
  if (!r) return NextResponse.json({ error: "Relatório inválido." }, { status: 400 });
  console.log("[beto-eval]", JSON.stringify(r));
  const pushed = pushConfigured() ? await sendToAll({ ...evalReportMessage(r), tag: "beto-eval" }) : 0;
  return NextResponse.json({ pushed });
}
