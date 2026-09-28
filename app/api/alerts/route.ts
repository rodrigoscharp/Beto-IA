import { NextRequest, NextResponse } from "next/server";
import { getGoogleToken } from "@/lib/google";
import { getMyHubContext } from "@/lib/myhub";
import { getBrasiliaTime } from "@/lib/time";
import { collectAgenda } from "@/lib/alerts/agenda";
import { collectEmail } from "@/lib/alerts/email";
import { collectGithub } from "@/lib/alerts/github";
import { myhubAlerts } from "@/lib/alerts/myhub";
import { Alert, Collected, EMPTY } from "@/lib/alerts/types";

/* POST /api/alerts  { seen: string[], baseline: boolean }
   Devolve o que o Beto deve avisar por conta própria. Sem estado no servidor:
   o navegador guarda os ids já vistos e os manda de volta a cada consulta. */

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const seen = new Set<string>(Array.isArray(body.seen) ? body.seen.slice(-600) : []);
  const baseline = body.baseline === true;

  const token = await getGoogleToken(req);
  const { date, hour } = getBrasiliaTime();

  const myhub = async (): Promise<Collected> => {
    const ctx = await getMyHubContext();
    return ctx ? { alerts: myhubAlerts(ctx, date, hour, Date.now()), mark: [] } : EMPTY;
  };

  const results = await Promise.allSettled([
    token ? collectAgenda(token)                 : EMPTY,
    token ? collectEmail(token, seen, baseline)  : EMPTY,
    collectGithub(seen, baseline),
    myhub(),
  ]);

  const alerts: Alert[] = [];
  const mark: string[] = [];
  for (const r of results) {
    if (r.status !== "fulfilled") { console.warn("[Beto alerts]", r.reason); continue; }
    alerts.push(...r.value.alerts.filter(a => !seen.has(a.id)));
    mark.push(...r.value.mark);
  }

  return NextResponse.json({ alerts, mark, googleConnected: !!token });
}
