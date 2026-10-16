import test from "node:test";
import assert from "node:assert/strict";
import { cleanCitations, webGuide, webAnswer, WEB_MODELS, WEB_FAIL_TEXT, WEB_TIMEOUT_MS } from "../lib/web.ts";

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
