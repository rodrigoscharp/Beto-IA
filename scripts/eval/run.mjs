/* Bateria de avaliação de fala: manda cada caso de evals/cases.json ao modelo (prompt e ferramentas de produção,
   nada é executado) e dá a nota. Uso: npm run eval -- [--model id] [--all] [--only prefixo] [--update-baseline] [--ci]
   Plano gratuito da Groq: uma chamada por vez, com intervalo (EVAL_GAP_MS) e espera no 429. */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { buildRequest } from "./context.mjs";
import { matchCase, majority, score, exitCode, isDrop, notRun, worstArea } from "./match.mjs";
import { detectNeedTools } from "../../lib/prompt.ts";

const RETRIES = 3;
const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function callWithRetry(fn, sleep) {
  for (let i = 0; ; i++) {
    try { return await fn(); }
    catch (e) {
      if (e?.status !== 429 || i >= RETRIES) throw e;
      const s = Number(e.headers?.["retry-after"]);
      await sleep((Number.isFinite(s) && s > 0 ? s : 10) * 1000);
    }
  }
}

function toResult(c) {
  const toolCalls = c.toolCalls.map((t) => {
    let args = null;
    try { args = t.arguments.trim() ? JSON.parse(t.arguments) : {}; } catch { /* JSON inválido: args null */ }
    return { name: t.name, args };
  });
  return { toolCalls, text: c.content, needTools: detectNeedTools(c.content) === "yes" };
}

export async function runSuite({ cases, fixtures, model, apiKey, gapMs = 2500, sleep = realSleep, call, log = console.log }) {
  const rows = [];
  let msTotal = 0, calls = 0, first = true;
  for (const caso of cases) {
    const tries = [];
    let status = "ok", motivo = "", ms = 0;
    try {
      for (let t = 0; t < (caso.repete ?? 1); t++) {
        if (!first && gapMs) await sleep(gapMs);
        first = false;
        const { params } = buildRequest(caso.conversa, fixtures);
        const t0 = Date.now();
        const c = await callWithRetry(() => call(apiKey, model, params), sleep);
        ms = Date.now() - t0; msTotal += ms; calls++;
        tries.push(matchCase(caso, toResult(c)));
      }
      const m = tries.length > 1 ? majority(tries) : tries[0];
      status = m.ok ? "ok" : "falhou";
      motivo = m.motivo;
    } catch (e) {
      status = "erro";
      motivo = e instanceof Error ? e.message : String(e);
    }
    rows.push({ id: caso.id, area: caso.area, status, motivo, ms });
    log(`${status === "ok" ? "✓" : status === "falhou" ? "✗" : "!"} ${caso.id}${motivo ? ` — ${motivo}` : ""}`);
  }
  return { model, rows, score: score(rows), avgMs: calls ? Math.round(msTotal / calls) : 0 };
}

const pct = (x) => `${Math.round(x * 1000) / 10}%`;

function parseArgs(argv) {
  const o = { all: false, ci: false, update: false, model: null, only: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--all") o.all = true;
    else if (a === "--ci") o.ci = true;
    else if (a === "--update-baseline") o.update = true;
    else if (a === "--model") o.model = argv[++i];
    else if (a === "--only") o.only = argv[++i];
  }
  return o;
}

async function main() {
  try { process.loadEnvFile(".env.local"); } catch { /* CI: variáveis vêm do ambiente */ }
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) { console.error("GROQ_API_KEY não definida (.env.local ou ambiente)."); process.exit(2); }
  const { groqCompleteOn, PREFERRED } = await import("../../lib/groq.ts");   // depois do .env: PREFERRED lê GROQ_MODEL
  const opts = parseArgs(process.argv.slice(2));
  const read = (p) => JSON.parse(readFileSync(p, "utf8"));
  let cases = read("evals/cases.json");
  if (opts.only) cases = cases.filter((c) => c.id.startsWith(opts.only));
  const fixtures = read("evals/fixtures.json");
  const baselines = existsSync("evals/baseline.json") ? read("evals/baseline.json") : {};
  const gapMs = Number(process.env.EVAL_GAP_MS ?? 2500);
  const models = opts.all ? PREFERRED : [opts.model ?? PREFERRED[0]];
  mkdirSync("evals/out", { recursive: true });

  const results = [];
  for (const model of models) {
    console.log(`\n== ${model} (${cases.length} casos) ==`);
    const r = await runSuite({ cases, fixtures, model, apiKey, gapMs, call: groqCompleteOn });
    results.push(r);
    const day = new Date().toISOString().slice(0, 10);
    writeFileSync(`evals/out/${day}-${model.replace(/[^\w.-]+/g, "_")}.json`, JSON.stringify(r, null, 2));
    const base = baselines[model];
    console.log(`\nNota: ${pct(r.score.total)} (${r.score.ok} ok, ${r.score.falhou} falharam, ${r.score.erro} erros)${base ? ` | baseline ${pct(base.total)}` : ""}`);
    for (const [a, v] of Object.entries(r.score.areas)) console.log(`  ${a.padEnd(12)} ${pct(v)}${base?.areas?.[a] !== undefined ? `  (base ${pct(base.areas[a])})` : ""}`);
    if (opts.update && !notRun(r.score) && !opts.only) {
      baselines[model] = { total: r.score.total, areas: r.score.areas, casos: cases.length, data: day };
      writeFileSync("evals/baseline.json", JSON.stringify(baselines, null, 2) + "\n");
      console.log("Baseline atualizado.");
    }
  }
  if (opts.all) {
    console.log("\nPlacar:");
    for (const r of [...results].sort((x, y) => y.score.total - x.score.total)) {
      console.log(`  ${pct(r.score.total).padStart(6)}  ${String(r.avgMs).padStart(5)} ms  ${r.model}${notRun(r.score) ? "  (não rodou)" : ""}`);
    }
  }
  if (opts.ci) {
    const r = results[0];
    const base = baselines[r.model];
    const code = exitCode(r.score, base);
    writeFileSync("evals/out/ci.json", JSON.stringify({
      status: code === 2 ? "nao_rodou" : isDrop(r.score, base) ? "queda" : "ok",
      total: r.score.total, baseline: base?.total ?? null, piorArea: worstArea(r.score, base),
    }));
    process.exit(code);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(2); });
}
