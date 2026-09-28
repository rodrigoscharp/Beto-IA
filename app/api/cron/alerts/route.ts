import { NextRequest, NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/cron-auth";
import { getServerGoogleToken } from "@/lib/google";
import { getBrasiliaTime } from "@/lib/time";
import { addSeen, hasSubscriptions, loadSeen, pruneSeen, pushConfigured, sendToAll } from "@/lib/push";
import { collectAgenda } from "@/lib/alerts/agenda";
import { collectEmail } from "@/lib/alerts/email";
import { collectGithub } from "@/lib/alerts/github";
import { Alert } from "@/lib/alerts/types";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_PER_RUN = 5;
const BASELINE = "__baseline__";
const TITLES = { email: "Email importante", agenda: "Agenda", github: "GitHub", myhub: "My Hub" } as const;

/* Roda a cada ~5 min (GitHub Actions). Manda por push o que é importante e ainda não foi avisado.
   Só urgente/importante: email importante, reunião chegando, review pedido, CI/deploy falhando.
   Hábito, treino e conflitos de agenda ficam para a voz. */

async function run(req: NextRequest) {
  try { return await execute(req); }
  catch (e) {
    console.error("[Beto cron]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "erro" }, { status: 500 });
  }
}

async function execute(req: NextRequest) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  if (!pushConfigured()) return NextResponse.json({ skipped: "VAPID não configurado" });

  const { hour } = getBrasiliaTime();
  if (hour >= 23 || hour < 7) return NextResponse.json({ skipped: "madrugada" });

  if (!(await hasSubscriptions())) return NextResponse.json({ skipped: "nenhum aparelho inscrito" });

  const token = await getServerGoogleToken();
  const seenList = await loadSeen();
  const seen = new Set(seenList);
  const baseline = !seen.has(BASELINE);

  const results = await Promise.allSettled([
    token ? collectAgenda(token) : { alerts: [], mark: [] },
    token ? collectEmail(token, seen, baseline) : { alerts: [], mark: [] },
    collectGithub(seen, baseline),
  ]);

  const alerts: Alert[] = [];
  const mark: string[] = [];
  for (const r of results) {
    if (r.status !== "fulfilled") { console.warn("[Beto cron]", r.reason); continue; }
    alerts.push(...r.value.alerts.filter(a => !seen.has(a.id) && a.until > Date.now() &&
      // conflitos de agenda não valem um push
      !a.id.startsWith("agenda:conflito")));
    mark.push(...r.value.mark);
  }

  alerts.sort((a, b) => b.priority - a.priority);
  const toSend = alerts.slice(0, MAX_PER_RUN);

  let sent = 0;
  for (const a of toSend) {
    const delivered = await sendToAll({ title: TITLES[a.source], body: a.text, tag: a.id, url: "/" });
    if (delivered > 0) { sent++; mark.push(a.id); }
  }

  // O que passou do limite por rodada fica sem marca e sai na próxima.
  await addSeen([...mark, ...(baseline ? [BASELINE] : [])]);
  if (new Date().getUTCMinutes() < 5) await pruneSeen();

  return NextResponse.json({ baseline, candidates: alerts.length, sent, googleToken: !!token });
}

export const GET  = run;
export const POST = run;
