import test from "node:test";
import assert from "node:assert/strict";
import { encodeLine, parseLine } from "../lib/voicewire.ts";

test("cada linha termina em uma única quebra, mesmo com quebra dentro do texto", () => {
  const line = encodeLine({ t: "primeira\nsegunda" });
  assert.equal(line.endsWith("\n"), true);
  assert.equal(line.slice(0, -1).includes("\n"), false);
  assert.deepEqual(parseLine(line), { t: "primeira\nsegunda" });
});

test("ida e volta de retry e meta", () => {
  assert.deepEqual(parseLine(encodeLine({ retry: true })), { retry: true });
  const meta = { mode: "full", undo: { path: "x/1", resumo: "Gasto de R$ 45,00", ts: 1 }, usedTools: true };
  assert.deepEqual(parseLine(encodeLine({ meta })), { meta });
});

test("linha vazia, inválida ou de outro formato devolve null", () => {
  assert.equal(parseLine(""), null);
  assert.equal(parseLine("não é json"), null);
  assert.equal(parseLine('{"x":1}'), null);
  assert.equal(parseLine('{"meta":{"mode":"outro"}}'), null);
});
