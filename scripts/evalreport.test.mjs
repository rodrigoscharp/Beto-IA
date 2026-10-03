import test from "node:test";
import assert from "node:assert/strict";
import { validEvalReport, evalReportMessage } from "../lib/ops.ts";

test("aceita queda e não rodou com números de 0 a 1 e área conhecida", () => {
  assert.deepEqual(validEvalReport({ status: "queda", total: 0.81, baseline: 0.92, piorArea: "agenda" }), { status: "queda", total: 0.81, baseline: 0.92, piorArea: "agenda" });
  assert.deepEqual(validEvalReport({ status: "nao_rodou", total: 0, baseline: null, piorArea: null }), { status: "nao_rodou", total: 0, baseline: null, piorArea: null });
});

test("recusa status, número ou área fora do esperado e texto livre", () => {
  for (const b of [null, "x", {}, { status: "ok" }, { status: "queda", total: 2 }, { status: "queda", total: 0.5, baseline: -1 },
    { status: "queda", total: 0.5, baseline: 0.9, piorArea: "<script>" }, { status: "queda", total: "0.5", baseline: 0.9 }]) {
    assert.equal(validEvalReport(b), null, JSON.stringify(b));
  }
});

test("mensagem do push", () => {
  assert.deepEqual(evalReportMessage({ status: "queda", total: 0.81, baseline: 0.92, piorArea: "agenda" }), { title: "Beto: avaliação caiu", body: "A nota caiu de 92% para 81% (pior área: agenda)." });
  assert.equal(evalReportMessage({ status: "nao_rodou", total: null, baseline: null, piorArea: null }).body, "A avaliação noturna não rodou (Groq fora do ar ou sem cota).");
});
