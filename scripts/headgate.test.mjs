import test from "node:test";
import assert from "node:assert/strict";
import { HeadGate } from "../lib/headgate.ts";

function run(chunks) {
  const g = new HeadGate();
  const out = chunks.map((c) => g.push(c));
  return { out, flushed: g.flush(), released: g.released };
}

test("texto normal sai na hora", () => {
  const r = run(["Oi, ", "chefe."]);
  assert.deepEqual(r.out, ["Oi, ", "chefe."]);
  assert.equal(r.released, true);
});

test("segura só tags de emoção e solta tudo (tags incluídas) quando chega texto de verdade", () => {
  const r = run(["[emo:ne", "utro] ", "Olá", " de novo"]);
  assert.deepEqual(r.out, ["", "", "[emo:neutro] Olá", " de novo"]);
  assert.equal(r.released, true);
});

test("resposta que é só tag nunca é solta: o modelo não 'começou' de verdade", () => {
  const r = run(["[emo:neutro]", " "]);
  assert.deepEqual(r.out, ["", ""]);
  assert.equal(r.released, false);
  assert.equal(r.flushed, "");
});

test("[NEEDTOOLS] depois da emoção conta como texto e é solto para o servidor decidir", () => {
  const r = run(["[emo:neutro] ", "[NEEDTOOLS]"]);
  assert.equal(r.out.join(""), "[emo:neutro] [NEEDTOOLS]");
  assert.equal(r.released, true);
});

test("colchete que não é tag de emoção é texto", () => {
  const r = run(["[1] é a opção"]);
  assert.deepEqual(r.out, ["[1] é a opção"]);
});

test("vazio e espaços não soltam nada", () => {
  const r = run(["", "  ", "\n"]);
  assert.deepEqual(r.out, ["", "", ""]);
  assert.equal(r.released, false);
});
