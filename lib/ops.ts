/* Funções puras de operação: cota da voz, saúde da lista de modelos e validação das métricas do navegador.
   Sem imports: rodam nas rotas e nos testes. */

export interface QuotaInfo {
  used: number | null;
  limit: number | null;
  remainingPct: number | null;
  resetUnix: number | null;
  tier: string | null;
  /** ok: sobra bastante; low: 25% ou menos; empty: acabou; unknown: não deu para ler. */
  level: "ok" | "low" | "empty" | "unknown";
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Resposta de GET /v1/user/subscription da ElevenLabs -> o que o Beto mostra. */
export function quotaStatus(sub: unknown): QuotaInfo {
  const o = (sub && typeof sub === "object" ? sub : {}) as Record<string, unknown>;
  const used = num(o.character_count);
  const limit = num(o.character_limit);
  const resetUnix = num(o.next_character_count_reset_unix);
  const tier = typeof o.tier === "string" ? o.tier : null;
  if (used === null || limit === null || limit <= 0) {
    return { used, limit, remainingPct: null, resetUnix, tier, level: "unknown" };
  }
  const remainingPct = Math.max(0, Math.round((100 * (limit - used)) / limit));
  const left = (limit - used) / limit;
  const level = used >= limit || remainingPct === 0 ? "empty" : left <= 0.25 ? "low" : "ok";   // 0% arredondado já é "acabou"
  return { used, limit, remainingPct, resetUnix, tier, level };
}

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
export const EVAL_AREAS = ["agenda", "myhub", "memoria", "spotify", "timer", "email", "github", "briefing", "conversa", "confirmacao"] as const;
