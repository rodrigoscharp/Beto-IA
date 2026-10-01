import test from "node:test";
import assert from "node:assert/strict";
import { ThinkFilter } from "../lib/thinkfilter.ts";

function run(chunks) {
  const f = new ThinkFilter();
  let out = "";
  for (const c of chunks) out += f.push(c);
  return out + f.flush();
}

test("texto sem bloco de raciocínio passa igual", () => {
  assert.equal(run(["Oi, chefe. ", "Tudo certo."]), "Oi, chefe. Tudo certo.");
});

test("remove o bloco <think>…</think> no começo", () => {
  assert.equal(run(["<think>pensando alto</think>Resposta final."]), "Resposta final.");
});

test("remove o bloco mesmo cortado em pedaços no meio das tags", () => {
  assert.equal(run(["<th", "ink>segre", "do</thi", "nk>ok"]), "ok");
  assert.equal(run(["a<", "think>x</think", ">b"]), "ab");
});

test("não segura texto que só parece o começo de uma tag", () => {
  assert.equal(run(["2 < 3 e 5 > 4"]), "2 < 3 e 5 > 4");
  assert.equal(run(["valor <b", "em> bom"]), "valor <bem> bom");
});

test("bloco que nunca fecha é descartado", () => {
  assert.equal(run(["antes <think>sem fim"]), "antes ");
});

test("vários blocos", () => {
  assert.equal(run(["<think>a</think>um <think>b</think>dois"]), "um dois");
});

test("pedaço vazio não quebra", () => {
  assert.equal(run(["", "oi", ""]), "oi");
});
