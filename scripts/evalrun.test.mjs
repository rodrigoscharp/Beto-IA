import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runSuite } from "./eval/run.mjs";

const fx = JSON.parse(readFileSync(new URL("../evals/fixtures.json", import.meta.url), "utf8"));
const caso = (id, content, espera, extra = {}) => ({ id, area: "conversa", conversa: [{ role: "user", content }], espera, ...extra });
const reply = (content, toolCalls = []) => ({ content, toolCalls, model: "m" });
const err = (status, headers = {}) => Object.assign(new Error(`status ${status}`), { status, headers });
const noSleep = async () => {};

test("aprova, reprova e marca erro; 429 com retry-after espera e tenta de novo", async () => {
  const waits = [];
  let n = 0;
  const call = async (_k, _m, params) => {
    const last = params.messages.at(-1).content;
    if (last === "limite") { n++; if (n === 1) throw err(429, { "retry-after": "3" }); return reply("[emo:neutro] Oi"); }
    if (last === "quebra") throw err(500);
    if (last === "args") return reply("", [{ id: "1", name: "create_event", arguments: "{nao json" }]);
    return reply("[emo:alegre] Tudo certo");
  };
  const r = await runSuite({
    cases: [
      caso("ok", "como você está hoje de manhã", { nenhumaFerramenta: true }),
      caso("limite", "limite", { nenhumaFerramenta: true }),
      caso("falha", "como vai a vida hoje em dia", { needTools: true }),
      caso("quebra", "quebra", { nenhumaFerramenta: true }),
    ],
    fixtures: fx, model: "m", apiKey: "k", gapMs: 0, call, log: () => {},
    sleep: async (ms) => { waits.push(ms); },
  });
  const by = Object.fromEntries(r.rows.map((x) => [x.id, x.status]));
  assert.deepEqual(by, { ok: "ok", limite: "ok", falha: "falhou", quebra: "erro" });
  assert.ok(waits.includes(3000));
  assert.equal(r.score.total, 0.667);   // score arredonda em 3 casas
});

test("429 quatro vezes seguidas vira erro, sem travar", async () => {
  const call = async () => { throw err(429); };
  const r = await runSuite({ cases: [caso("a", "oi tudo bem contigo", { nenhumaFerramenta: true })], fixtures: fx, model: "m", apiKey: "k", gapMs: 0, call, sleep: noSleep, log: () => {} });
  assert.equal(r.rows[0].status, "erro");
});

test("repete usa a maioria", async () => {
  let i = 0;
  const call = async () => reply(i++ === 0 ? "" : "[emo:neutro] Oi");
  const r = await runSuite({ cases: [caso("a", "oi tudo bem contigo", { nenhumaFerramenta: true }, { repete: 3 })], fixtures: fx, model: "m", apiKey: "k", gapMs: 0, call, sleep: noSleep, log: () => {} });
  assert.equal(r.rows[0].status, "ok");
});

test("Groq fora do ar: todos erro, nota não conta como queda", async () => {
  const { exitCode } = await import("./eval/match.mjs");
  const call = async () => { throw err(503); };
  const r = await runSuite({ cases: [caso("a", "x y z", { nenhumaFerramenta: true }), caso("b", "x y w", { nenhumaFerramenta: true })], fixtures: fx, model: "m", apiKey: "k", gapMs: 0, call, sleep: noSleep, log: () => {} });
  assert.equal(exitCode(r.score, { total: 0.9 }), 2);
});

test("retry-after longo é limitado a 60 s", async () => {
  const waits = [];
  let n = 0;
  const call = async () => { if (n++ === 0) throw err(429, { "retry-after": "600" }); return reply("[emo:neutro] Oi"); };
  await runSuite({ cases: [caso("a", "oi tudo bem contigo", { nenhumaFerramenta: true })], fixtures: fx, model: "m", apiKey: "k", gapMs: 0, call, sleep: async (ms) => { waits.push(ms); }, log: () => {} });
  assert.deepEqual(waits, [60_000]);
});

test("orçamento de tempo estourado: casos restantes viram erro sem chamar o modelo", async () => {
  let clock = 0, calls = 0;
  const call = async () => { calls++; clock += 1000; return reply("[emo:neutro] Oi"); };
  const cases = ["a", "b", "c"].map((id) => caso(id, "oi tudo bem contigo", { nenhumaFerramenta: true }));
  const r = await runSuite({ cases, fixtures: fx, model: "m", apiKey: "k", gapMs: 0, call, sleep: noSleep, log: () => {}, budgetMs: 1500, now: () => clock });
  assert.deepEqual(r.rows.map((x) => x.status), ["ok", "ok", "erro"]);
  assert.equal(calls, 2);
  assert.match(r.rows[2].motivo, /tempo/);
});
