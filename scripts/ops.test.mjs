import test from "node:test";
import assert from "node:assert/strict";
import { checkModels, validMetric } from "../lib/ops.ts";

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
