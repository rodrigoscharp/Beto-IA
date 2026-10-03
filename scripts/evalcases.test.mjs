import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateCases } from "./eval/match.mjs";
import { toolNames } from "./eval/context.mjs";

const cases = JSON.parse(readFileSync(new URL("../evals/cases.json", import.meta.url), "utf8"));

test("evals/cases.json é válido", () => {
  assert.deepEqual(validateCases(cases, toolNames()), []);
});

test("bateria tem tamanho e cobertura mínimos", () => {
  assert.ok(cases.length >= 100, `só ${cases.length} casos`);
  const areas = new Set(cases.map((c) => c.area));
  for (const a of ["agenda", "myhub", "memoria", "spotify", "timer", "conversa", "confirmacao"]) assert.ok(areas.has(a), `sem casos de ${a}`);
  assert.ok(cases.filter((c) => c.area === "conversa").length >= 20, "menos de 20 casos de conversa pura");
});
