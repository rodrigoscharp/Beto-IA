import { NextRequest, NextResponse } from "next/server";
import Groq from "groq-sdk";
import { cronAuthorized } from "@/lib/cron-auth";
import { PREFERRED, deadModels } from "@/lib/groq";
import { checkModels } from "@/lib/ops";
import { pushConfigured, sendToAll } from "@/lib/push";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/* Roda 1x por dia (GitHub Actions). Compara a lista de modelos preferidos com o que a Groq oferece hoje.
   Os mortos ficam nos logs ("[beto-models]") e, se sobrarem menos de 3, chega um push. */
async function run(req: NextRequest) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "GROQ_API_KEY não configurada." }, { status: 500 });

  try {
    const groq = new Groq({ apiKey, maxRetries: 1, timeout: 15_000, baseURL: process.env.GROQ_BASE_URL || undefined });
    const available = (await groq.models.list()).data.map((m) => m.id);
    const r = checkModels(PREFERRED, available);
    console.log("[beto-models]", JSON.stringify({ alive: r.alive.length, missing: r.missing, low: r.low, deadInThisInstance: deadModels() }));

    let pushed = 0;
    if (r.low && pushConfigured()) {
      pushed = await sendToAll({
        title: "Beto: poucos modelos da Groq",
        body: `Só ${r.alive.length} modelos da lista ainda existem. Faltando: ${r.missing.join(", ") || "nenhum"}. Atualize a lista em lib/groq.ts.`,
        tag: "beto-models",
      });
    }
    return NextResponse.json({ alive: r.alive, missing: r.missing, low: r.low, pushed });
  } catch (e) {
    console.error("[beto-models] erro", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "erro" }, { status: 500 });
  }
}

export const GET = run;
export const POST = run;
