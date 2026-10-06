import test from "node:test";
import assert from "node:assert/strict";
import { CONTENT_TOOLS, executeContentTool } from "../lib/tools/content.ts";

const secao = { plano: "Marca 10K", titulo: "Ep. 2 — A conta", texto: "Ep. 2 — A conta\nTempo: 0–3s; Fala: oi" };
const ctx = (api) => ({ api, state: { calls: 0 } });

test("a ferramenta existe com o nome e o parâmetro busca", () => {
  const f = CONTENT_TOOLS[0].function;
  assert.equal(f.name, "content_plan");
  assert.deepEqual(f.parameters.required, ["busca"]);
});

test("devolve as seções achadas", async () => {
  let pedido;
  const r = await executeContentTool("content_plan", { busca: "ep 2" }, ctx({ buscar: async (b) => { pedido = b; return { secoes: [secao] }; } }));
  assert.equal(pedido, "ep 2");
  assert.deepEqual(r.secoes, [secao]);
});

test("nada achado: diz que não tem, para o Beto não inventar o roteiro", async () => {
  const r = await executeContentTool("content_plan", { busca: "ep 99" }, ctx({ buscar: async () => ({ secoes: [] }) }));
  assert.deepEqual(r.secoes, []);
  assert.match(r.aviso, /não invente/i);
});

test("My Hub fora do ar ou não configurado: erro, sem conteúdo", async () => {
  assert.ok((await executeContentTool("content_plan", { busca: "ep 2" }, ctx({ buscar: async () => null }))).error);
  assert.ok((await executeContentTool("content_plan", { busca: "ep 2" }, ctx(null))).error);
});

test("busca inválida é recusada sem chamar o My Hub", async () => {
  let chamou = false;
  const api = { buscar: async () => { chamou = true; return { secoes: [] }; } };
  for (const busca of ["", "   ", 42, "x".repeat(121)]) assert.ok((await executeContentTool("content_plan", { busca }, ctx(api))).error);
  assert.equal(chamou, false);
});

test("no máximo 3 buscas por mensagem", async () => {
  const c = ctx({ buscar: async () => ({ secoes: [] }) });
  for (let i = 0; i < 3; i++) assert.ok(!(await executeContentTool("content_plan", { busca: "ep 2" }, c)).error);
  assert.ok((await executeContentTool("content_plan", { busca: "ep 2" }, c)).error);
});

test("texto muito grande é cortado", async () => {
  const big = { ...secao, texto: "a".repeat(10000) };
  const r = await executeContentTool("content_plan", { busca: "ep 2" }, ctx({ buscar: async () => ({ secoes: [big] }) }));
  assert.ok(r.secoes[0].texto.length < 5000);
});
