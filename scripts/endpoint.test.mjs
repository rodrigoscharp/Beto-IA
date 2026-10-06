import test from "node:test";
import assert from "node:assert/strict";
import { silenceMs, afterWake, MAX_UTTERANCE_MS } from "../lib/endpoint.ts";

test("frase completa espera um respiro de verdade, não 700ms", () => {
  const ms = silenceMs("me fala o que eu tenho na agenda amanhã");
  assert.ok(ms >= 1200 && ms <= 1800, String(ms));
});

test("frase pendurada (conectivo, hesitação, vírgula) espera bem mais: ele ainda vai continuar", () => {
  const full = silenceMs("me fala o que eu tenho na agenda amanhã");
  for (const t of ["eu pergunto pra ele e", "o Beto ele simplesmente pega é", "aí ele começou a inventar que", "tipo assim,",
    "então", "é, eu", "o problema é que o", "porque"]) {
    assert.ok(silenceMs(t) > full + 800, `${t}: ${silenceMs(t)}`);
  }
});

test("fala bem curta também espera mais (começo de frase)", () => {
  assert.ok(silenceMs("olha só") > silenceMs("me fala o que eu tenho na agenda amanhã"));
});

test("hesitação com acento ou caixa diferente conta igual", () => {
  assert.equal(silenceMs("Então É"), silenceMs("entao e"));
});

test("teto da fala é longo: ninguém é cortado no meio de uma explicação", () => {
  assert.ok(MAX_UTTERANCE_MS >= 45000);
});

test("afterWake guarda o que veio depois do nome, para não perder o começo do pedido", () => {
  const w = ["beto", "ei beto", "oi beto"];
  assert.equal(afterWake("ei beto me fala a agenda", w), "me fala a agenda");
  assert.equal(afterWake("Beto, o que tem hoje", w), "o que tem hoje");
  assert.equal(afterWake("beto", w), "");
  assert.equal(afterWake("sem nome aqui", w), "");
});
