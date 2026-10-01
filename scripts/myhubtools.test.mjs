import test from "node:test";
import assert from "node:assert/strict";
import { MYHUB_TOOLS, executeMyHubTool } from "../lib/tools/myhub.ts";

function fakeApi({ registerResult, undoOk = true } = {}) {
  const calls = [];
  return {
    calls,
    async register(acao, entrada) {
      calls.push(["register", acao, entrada]);
      return registerResult ?? { ok: true, acao: { titulo: "Despesa", resumo: `Despesa de R$ ${Number(entrada.valorEmReais ?? 0).toFixed(2).replace(".", ",")}`, campos: [], desfazer: `tx/${calls.length}` } };
    },
    async undo(path) { calls.push(["undo", path]); return undoOk; },
  };
}
const NOW = Date.parse("2026-10-02T12:00:00Z");
const ctx = (api, extra = {}) => ({ api, writeIntent: true, undoIntent: false, confirmed: false, lastAssistant: "", undo: null, nowMs: NOW, state: { writes: 0, seen: [] }, ...extra });
const run = (name, args, c) => executeMyHubTool(name, args, c);
const gasto = (v, extra = {}) => ({ acao: "registrarTransacao", entrada: { tipo: "despesa", valorEmReais: v, descricao: "Mercado da semana", categoria: "Mercado", ...extra } });

test("definições: duas ferramentas, esquema válido e enxuto", () => {
  assert.deepEqual(MYHUB_TOOLS.map((t) => t.function.name).sort(), ["my_hub_register", "my_hub_undo"]);
  for (const t of MYHUB_TOOLS) { assert.equal(t.type, "function"); assert.equal(t.function.parameters.type, "object"); assert.ok(t.function.description.length > 20); }
  assert.deepEqual(MYHUB_TOOLS[0].function.parameters.required, ["acao", "entrada"]);
  assert.ok(JSON.stringify(MYHUB_TOOLS).length < 1800);
});

test("registrar: executa no My Hub, devolve o resumo e guarda o caminho de desfazer", async () => {
  const api = fakeApi(); const c = ctx(api);
  const r = await run("my_hub_register", gasto(45), c);
  assert.equal(r.status, "registered");
  assert.match(r.resumo, /45/);
  assert.equal(r.can_undo, true);
  assert.deepEqual(api.calls[0], ["register", "registrarTransacao", gasto(45).entrada]);
  assert.equal(c.state.undo.path, "tx/1");
  assert.equal(c.state.writes, 1);
});

test("registrar: o My Hub recusou (ambíguo, faltou dado): volta como failed com o motivo para o modelo perguntar", async () => {
  const api = fakeApi({ registerResult: { ok: false, erro: "Qual conta: Carteira ou PJ?" } });
  const r = await run("my_hub_register", gasto(45), ctx(api));
  assert.equal(r.status, "failed");
  assert.match(r.error, /Carteira ou PJ/);
  assert.match(r.instruction, /pergunte/i);
});

test("registrar: sem intenção de escrita, sem My Hub configurado e argumentos inválidos", async () => {
  const api = fakeApi();
  assert.match((await run("my_hub_register", gasto(45), ctx(api, { writeIntent: false }))).error, /não pediu/i);
  assert.match((await run("my_hub_register", gasto(45), ctx(null))).error, /configurad/i);
  assert.match((await run("my_hub_register", { entrada: {} }, ctx(api))).error, /acao/i);
  assert.match((await run("my_hub_register", { acao: "../etc/passwd", entrada: {} }, ctx(api))).error, /acao/i);
  assert.match((await run("my_hub_register", { acao: "registrarTransacao", entrada: "texto" }, ctx(api))).error, /entrada/i);
  assert.match((await run("my_hub_register", { acao: "registrarTransacao", entrada: [] }, ctx(api))).error, /entrada/i);
  assert.match((await run("my_hub_register", "x", ctx(api))).error, /argumentos/i);
  assert.match((await run("hackear", {}, ctx(api))).error, /desconhecida/i);
  assert.equal(api.calls.length, 0);
});

test("no máximo 3 registros e nenhum duplicado por mensagem", async () => {
  const api = fakeApi(); const c = ctx(api);
  assert.equal((await run("my_hub_register", gasto(10), c)).status, "registered");
  assert.match((await run("my_hub_register", gasto(10), c)).error, /já foi/i);
  assert.equal((await run("my_hub_register", gasto(20), c)).status, "registered");
  assert.equal((await run("my_hub_register", gasto(30), c)).status, "registered");
  assert.match((await run("my_hub_register", gasto(40), c)).error, /três/i);
  assert.equal(api.calls.filter((x) => x[0] === "register").length, 3);
});

test("duplicado é detectado mesmo com a ordem dos campos trocada", async () => {
  const api = fakeApi(); const c = ctx(api);
  await run("my_hub_register", { acao: "registrarTransacao", entrada: { tipo: "despesa", valorEmReais: 10 } }, c);
  const r = await run("my_hub_register", { acao: "registrarTransacao", entrada: { valorEmReais: 10, tipo: "despesa" } }, c);
  assert.match(r.error, /já foi/i);
});

test("valor acima de R$ 1.000 pede confirmação com a frase pronta e não registra", async () => {
  const api = fakeApi();
  const r = await run("my_hub_register", gasto(1500), ctx(api));
  assert.equal(r.status, "needs_confirmation");
  assert.match(r.ask_with, /R\$ 1\.500,00/);
  assert.match(r.ask_with, /despesa/i);
  assert.match(r.ask_with, /Mercado/);
  assert.match(r.ask_with, /\?$/);
  assert.equal(api.calls.length, 0);
  const rec = await run("my_hub_register", { acao: "registrarTransacao", entrada: { tipo: "receita", valorEmReais: "2.500,50", descricao: "Freelance" } }, ctx(api));
  assert.equal(rec.status, "needs_confirmation");
  assert.match(rec.ask_with, /receita/i);
  assert.match(rec.ask_with, /R\$ 2\.500,50/);
});

test("confirmação do valor: só vale se o 'sim' veio depois de uma pergunta que CITOU o valor", async () => {
  const api = fakeApi();
  const sem = await run("my_hub_register", gasto(1500), ctx(api, { confirmed: true, lastAssistant: "quer que eu registre isso?" }));
  assert.equal(sem.status, "needs_confirmation");
  const outro = await run("my_hub_register", gasto(1500), ctx(api, { confirmed: true, lastAssistant: "registro uma despesa de r$ 150,00 em mercado?" }));
  assert.equal(outro.status, "needs_confirmation", "citou 150, não 1.500");
  const naoConf = await run("my_hub_register", gasto(1500), ctx(api, { confirmed: false, lastAssistant: "registro uma despesa de R$ 1.500,00 em mercado?" }));
  assert.equal(naoConf.status, "needs_confirmation");
  assert.equal(api.calls.length, 0);
  for (const frase of ["Registro uma despesa de R$ 1.500,00 em Mercado?", "registro 1500 reais de mercado?", "Anoto 1.500 no mercado?"]) {
    const ok = await run("my_hub_register", gasto(1500), ctx(fakeApi(), { confirmed: true, lastAssistant: frase }));
    assert.equal(ok.status, "registered", frase);
  }
});

test("exatamente R$ 1.000 passa direto; valor em texto ('1.200,50') também é medido", async () => {
  assert.equal((await run("my_hub_register", gasto(1000), ctx(fakeApi()))).status, "registered");
  assert.equal((await run("my_hub_register", gasto("1.200,50"), ctx(fakeApi()))).status, "needs_confirmation");
  assert.equal((await run("my_hub_register", gasto("R$ 999,99"), ctx(fakeApi()))).status, "registered");
});

test("valor alto só vale para transação; hábito e tarefa não passam por esse teste", async () => {
  const api = fakeApi();
  assert.equal((await run("my_hub_register", { acao: "registrarCheckinHabito", entrada: { habito: "Beber água", quantidade: 5000 } }, ctx(api))).status, "registered");
});

test("desfazer: usa o caminho guardado e limpa", async () => {
  const api = fakeApi(); const c = ctx(api, { undoIntent: true, undo: { path: "tx/9", resumo: "Despesa de R$ 45,00", ts: NOW - 60_000 } });
  const r = await run("my_hub_undo", {}, c);
  assert.equal(r.status, "undone");
  assert.match(r.resumo, /45/);
  assert.deepEqual(api.calls, [["undo", "tx/9"]]);
  assert.equal(c.state.undone, true);
});

test("desfazer: sem pedido, sem registro, registro velho, sem caminho e falha", async () => {
  const api = fakeApi();
  assert.match((await run("my_hub_undo", {}, ctx(api, { undoIntent: false, undo: { path: "p", resumo: "x", ts: NOW } }))).error, /não pediu/i);
  assert.equal((await run("my_hub_undo", {}, ctx(api, { undoIntent: true }))).status, "nothing_to_undo");
  assert.equal((await run("my_hub_undo", {}, ctx(api, { undoIntent: true, undo: { path: "p", resumo: "x", ts: NOW - 16 * 60_000 } }))).status, "nothing_to_undo");
  assert.equal((await run("my_hub_undo", {}, ctx(api, { undoIntent: true, undo: { path: null, resumo: "x", ts: NOW } }))).status, "cannot_undo");
  assert.equal((await run("my_hub_undo", {}, ctx(fakeApi({ undoOk: false }), { undoIntent: true, undo: { path: "p", resumo: "x", ts: NOW } }))).status, "failed");
  assert.equal(api.calls.length, 0);
});
