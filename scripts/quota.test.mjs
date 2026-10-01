import test from "node:test";
import assert from "node:assert/strict";
import { quotaStatus, checkModels, validMetric } from "../lib/ops.ts";

test("cota: percentual restante e arredondamento", () => {
  const q = quotaStatus({ character_count: 9995, character_limit: 10000, next_character_count_reset_unix: 1790000000, tier: "free" });
  assert.deepEqual(q, { used: 9995, limit: 10000, remainingPct: 0, resetUnix: 1790000000, tier: "free", level: "empty" });
});

test("cota: níveis ok / low / empty", () => {
  assert.equal(quotaStatus({ character_count: 1000, character_limit: 10000 }).level, "ok");
  assert.equal(quotaStatus({ character_count: 7500, character_limit: 10000 }).level, "low");   // 25% restante
  assert.equal(quotaStatus({ character_count: 7499, character_limit: 10000 }).level, "ok");    // 25,01%
  assert.equal(quotaStatus({ character_count: 10000, character_limit: 10000 }).level, "empty");
  assert.equal(quotaStatus({ character_count: 12000, character_limit: 10000 }).remainingPct, 0);
});

test("cota: resposta estranha vira indisponível, nunca NaN", () => {
  assert.equal(quotaStatus({}).level, "unknown");
  assert.equal(quotaStatus({ character_count: "x", character_limit: 0 }).remainingPct, null);
  assert.equal(quotaStatus(null).level, "unknown");
});

test("modelos: separa vivos e mortos, alerta quando sobram poucos", () => {
  const r = checkModels(["a", "b", "c", "d"], ["b", "d", "z"]);
  assert.deepEqual(r.alive, ["b", "d"]);
  assert.deepEqual(r.missing, ["a", "c"]);
  assert.equal(r.low, true);
  assert.equal(checkModels(["a", "b", "c"], ["a", "b", "c"]).low, false);
  assert.equal(checkModels(["a", "b", "c"], []).alive.length, 0);
});

test("métrica do navegador: só aceita número e valores conhecidos", () => {
  assert.deepEqual(validMetric({ evt: "ttfa", ms: 842.4, via: "stream" }), { evt: "ttfa", ms: 842, via: "stream" });
  assert.equal(validMetric({ evt: "ttfa", ms: -1, via: "stream" }), null);
  assert.equal(validMetric({ evt: "ttfa", ms: 999999, via: "stream" }), null);
  assert.equal(validMetric({ evt: "ttfa", ms: 100, via: "<script>" }), null);
  assert.equal(validMetric({ evt: "outra", ms: 100, via: "full" }), null);
  assert.equal(validMetric({ evt: "ttfa", ms: "100", via: "full" }), null);
  assert.equal(validMetric(null), null);
});
