/* Funções puras de operação: saúde da lista de modelos e validação das métricas do navegador.
   Sem imports: rodam nas rotas e nos testes. */

/** Compara a lista de modelos preferidos com os que a Groq oferece. `low`: sobraram menos de 3. */
export function checkModels(preferred: string[], available: string[]) {
  const have = new Set(available);
  const alive = preferred.filter((m) => have.has(m));
  const missing = preferred.filter((m) => !have.has(m));
  return { alive, missing, low: alive.length < 3 };
}

const VIAS = ["stream", "full", "greeting", "text"] as const;

/** Métrica enviada pelo navegador: só número em faixa razoável e valores de uma lista fixa. Nunca texto livre. */
export function validMetric(body: unknown): { evt: "ttfa"; ms: number; via: (typeof VIAS)[number] } | null {
  if (!body || typeof body !== "object") return null;
  const o = body as Record<string, unknown>;
  if (o.evt !== "ttfa") return null;
  if (typeof o.ms !== "number" || !Number.isFinite(o.ms) || o.ms < 0 || o.ms > 120_000) return null;
  if (!VIAS.includes(o.via as never)) return null;
  return { evt: "ttfa", ms: Math.round(o.ms), via: o.via as (typeof VIAS)[number] };
}

/** Áreas da bateria de avaliação (evals/cases.json). A rota de relatório só aceita estes nomes. */
export const EVAL_AREAS = ["agenda", "myhub", "memoria", "spotify", "timer", "email", "github", "briefing", "conversa", "confirmacao", "estilo"] as const;

export type EvalArea = (typeof EVAL_AREAS)[number];
export interface EvalReport { status: "queda" | "nao_rodou"; total: number | null; baseline: number | null; piorArea: EvalArea | null }

const frac = (v: unknown): number | null | undefined =>
  v === null || v === undefined ? null : typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1 ? v : undefined;

/** Corpo enviado pelo GitHub Actions quando a avaliação noturna reprova. Só números e nomes fixos: nada vira texto livre no push. */
export function validEvalReport(body: unknown): EvalReport | null {
  if (!body || typeof body !== "object") return null;
  const o = body as Record<string, unknown>;
  if (o.status !== "queda" && o.status !== "nao_rodou") return null;
  const total = frac(o.total), baseline = frac(o.baseline);
  if (total === undefined || baseline === undefined) return null;
  const area = o.piorArea ?? null;
  if (area !== null && !EVAL_AREAS.includes(area as EvalArea)) return null;
  return { status: o.status, total, baseline, piorArea: area as EvalArea | null };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

export function evalReportMessage(r: EvalReport): { title: string; body: string } {
  if (r.status === "nao_rodou") return { title: "Beto: avaliação não rodou", body: "A avaliação noturna não rodou (Groq fora do ar, sem cota ou erro no job)." };
  const de = r.baseline !== null ? `de ${pct(r.baseline)} ` : "";
  const para = r.total !== null ? `para ${pct(r.total)}` : "";
  const area = r.piorArea ? ` (pior área: ${r.piorArea})` : "";
  return { title: "Beto: avaliação caiu", body: `A nota caiu ${de}${para}${area}.`.replace(/\s+\./, ".") };
}
