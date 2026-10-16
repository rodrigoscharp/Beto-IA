import test from "node:test";
import assert from "node:assert/strict";
import { cleanCitations, webGuide, webAnswer, WEB_MODELS, WEB_FAIL_TEXT, WEB_TIMEOUT_MS, WEB_DEADLINE_MS, WEB_MIN_TRY_MS } from "../lib/web.ts";

test("cleanCitations tira marcadores e URL e mantém a emoção", () => {
  assert.equal(cleanCitations("[emo:neutro] O dólar fechou a cinco e dez【2†L6-L10】, segundo o g1【3†L1-L2】."),
    "[emo:neutro] O dólar fechou a cinco e dez, segundo o g1.");
  assert.equal(cleanCitations("Veja em https://g1.globo.com/economia e  http://x.io hoje."), "Veja em e hoje.");
});

test("webGuide pede fonte pelo nome e proíbe inventar", () => {
  const g = webGuide();
  for (const k of ["fonte", "nunca pela URL", "não invente", "de quando"]) assert.ok(g.includes(k), k);
});

const call = (plan) => async (_k, model, params) => {
  assert.deepEqual(params.tools, [{ type: "browser_search" }]);
  assert.equal(params.tool_choice, "required");
  const r = plan[model];
  if (r instanceof Error) throw r;
  return { content: r };
};

test("primeiro modelo responde", async () => {
  const r = await webAnswer("k", "SYS", [{ role: "user", content: "dólar" }], call({ [WEB_MODELS[0]]: "[emo:neutro] Cinco e dez【1†L1】." }));
  assert.deepEqual(r, { text: "[emo:neutro] Cinco e dez.", model: WEB_MODELS[0], ok: true });
});

test("primeiro falha ou volta vazio depois da limpeza, segundo responde", async () => {
  const r1 = await webAnswer("k", "SYS", [], call({ [WEB_MODELS[0]]: new Error("429"), [WEB_MODELS[1]]: "Ok." }));
  assert.equal(r1.model, WEB_MODELS[1]);
  const r2 = await webAnswer("k", "SYS", [], call({ [WEB_MODELS[0]]: "【1†L1】 https://a.b", [WEB_MODELS[1]]: "Ok." }));
  assert.equal(r2.model, WEB_MODELS[1]);
});

test("os dois falham: texto de falha, ok false", async () => {
  const r = await webAnswer("k", "SYS", [], call({ [WEB_MODELS[0]]: new Error("429"), [WEB_MODELS[1]]: new Error("429") }));
  assert.deepEqual(r, { text: WEB_FAIL_TEXT, model: null, ok: false });
});

test("a busca tem timeout próprio de 30 s", () => {
  assert.equal(WEB_TIMEOUT_MS, 30_000);
});

test("prazo total de 40 s, teto de 30 s por modelo e mínimo de 8 s para tentar o próximo", () => {
  assert.equal(WEB_DEADLINE_MS, 40_000);
  assert.equal(WEB_MIN_TRY_MS, 8_000);
});

/* Relógio falso: cada modelo "demora" o que o plano manda, avançando o relógio antes de responder ou lançar. */
const timed = (plan, clock, timeouts) => async (_k, model, _p, timeoutMs) => {
  timeouts.push([model, timeoutMs]);
  const { ms, r } = plan[model];
  clock.t += ms;
  if (r instanceof Error) throw r;
  return { content: r };
};

test("primeiro modelo demora 35 s e falha: o segundo não é tentado e vem a falha", async () => {
  const clock = { t: 0 }, timeouts = [];
  const r = await webAnswer("k", "SYS", [], timed({
    [WEB_MODELS[0]]: { ms: 35_000, r: new Error("timeout") },
    [WEB_MODELS[1]]: { ms: 1_000, r: "Ok." },
  }, clock, timeouts), () => clock.t);
  assert.deepEqual(r, { text: WEB_FAIL_TEXT, model: null, ok: false });
  assert.deepEqual(timeouts, [[WEB_MODELS[0], 30_000]]);
});

test("primeiro falha rápido: o segundo recebe no máximo 30 s e responde", async () => {
  const clock = { t: 0 }, timeouts = [];
  const r = await webAnswer("k", "SYS", [], timed({
    [WEB_MODELS[0]]: { ms: 1_000, r: new Error("429") },
    [WEB_MODELS[1]]: { ms: 2_000, r: "Ok." },
  }, clock, timeouts), () => clock.t);
  assert.deepEqual(r, { text: "Ok.", model: WEB_MODELS[1], ok: true });
  assert.equal(timeouts[0][1], 30_000);
  assert.equal(timeouts[1][0], WEB_MODELS[1]);
  assert.ok(timeouts[1][1] <= 30_000, String(timeouts[1][1]));
});

test("o segundo modelo recebe só o que resta do prazo quando é menos que 30 s", async () => {
  const clock = { t: 0 }, timeouts = [];
  await webAnswer("k", "SYS", [], timed({
    [WEB_MODELS[0]]: { ms: 20_000, r: new Error("500") },
    [WEB_MODELS[1]]: { ms: 1_000, r: "Ok." },
  }, clock, timeouts), () => clock.t);
  assert.deepEqual(timeouts, [[WEB_MODELS[0], 30_000], [WEB_MODELS[1], 20_000]]);
});

test("cleanCitations tira o marcador cortado no fim da resposta", () => {
  assert.equal(cleanCitations("[emo:neutro] O dólar fechou a cinco e dez【2†L6"), "[emo:neutro] O dólar fechou a cinco e dez");
  assert.equal(cleanCitations("Fechou em alta【"), "Fechou em alta");
});
