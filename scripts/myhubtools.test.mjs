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
  for (const frase of ["Registro uma despesa de R$ 1.500,00 (Mercado da semana) em Mercado?", "registro uma despesa de 1500 reais, mercado da semana, em mercado?"]) {
    const ok = await run("my_hub_register", gasto(1500), ctx(fakeApi(), { confirmed: true, lastAssistant: frase }));
    assert.equal(ok.status, "registered", frase);
  }
  for (const frase of ["Anoto 1.500 no mercado?", "Registro uma despesa de R$ 1.500,00 em Mercado?"]) {
    const nao = await run("my_hub_register", gasto(1500), ctx(fakeApi(), { confirmed: true, lastAssistant: frase }));
    assert.equal(nao.status, "needs_confirmation", `${frase}: faltou o tipo ou a descrição`);
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

/* ── Revisão do My Hub ──────────────────────────────────────────────────── */

test("valor que não vira número positivo é RECUSADO (nunca passa cru para o My Hub)", async () => {
  for (const v of ["mil e quinhentos", "2 mil", "1k", "1e4", -5000, "-5000", NaN, Infinity, "abc", "1,500", 0, "0"]) {
    const api = fakeApi();
    const r = await run("my_hub_register", gasto(v), ctx(api));
    assert.match(r.error ?? "", /valor/i, String(v));
    assert.equal(api.calls.length, 0, `${String(v)} não pode chegar ao My Hub`);
  }
});

test("o My Hub recebe o número JÁ interpretado: '1.500' vira 1500, '45,50' vira 45.5, 'valor' vira valorEmReais", async () => {
  const api = fakeApi();
  await run("my_hub_register", gasto("1.500"), ctx(api, { confirmed: true, lastAssistant: "Registro uma despesa de R$ 1.500,00 (Mercado da semana) em Mercado?" }));
  assert.equal(api.calls[0][2].valorEmReais, 1500);
  const api2 = fakeApi();
  await run("my_hub_register", gasto("45,50"), ctx(api2));
  assert.equal(api2.calls[0][2].valorEmReais, 45.5);
  const api3 = fakeApi();
  await run("my_hub_register", { acao: "registrarTransacao", entrada: { tipo: "despesa", valor: "R$ 30", descricao: "x", categoria: "Mercado" } }, ctx(api3));
  assert.equal(api3.calls[0][2].valorEmReais, 30);
  assert.ok(!("valor" in api3.calls[0][2]));
});

test("a trava vale para qualquer ação com campo de valor e para maiúsculas diferentes", async () => {
  for (const [acao, entrada] of [
    ["RegistrarTransacao", { tipo: "despesa", valorEmReais: 9000, descricao: "x" }],
    ["registrarTransacao", { tipo: "despesa", quantia: 9000, descricao: "x" }],
    ["registrarTransacao", { tipo: "despesa", amount: 9000, descricao: "x" }],
    ["pagarFatura", { valorEmReais: 2000 }],
    ["registrarAporte", { valor: 5000, meta: "Viagem" }],
    ["registrarTransacao", { tipo: "despesa", valorEmCentavos: 250000, descricao: "x" }],
  ]) {
    const api = fakeApi();
    const r = await run("my_hub_register", { acao, entrada }, ctx(api));
    assert.equal(r.status, "needs_confirmation", `${acao} ${JSON.stringify(entrada)}`);
    assert.equal(api.calls.length, 0);
  }
  const api = fakeApi();
  assert.equal((await run("my_hub_register", { acao: "registrarCheckinHabito", entrada: { habito: "Beber água", quantidade: 5000 } }, ctx(api))).status, "registered");
  assert.equal((await run("my_hub_register", { acao: "pagarFatura", entrada: { valorEmReais: 200 } }, ctx(api))).status, "registered");
});

test("o 'sim' vale só para O registro perguntado: tipo, categoria e descrição têm de bater", async () => {
  const q = "Registro uma despesa de R$ 1.500,00 (Mercado da semana) em Mercado?";
  const ok = await run("my_hub_register", gasto(1500), ctx(fakeApi(), { confirmed: true, lastAssistant: q }));
  assert.equal(ok.status, "registered");
  const receita = await run("my_hub_register", gasto(1500, { tipo: "receita" }), ctx(fakeApi(), { confirmed: true, lastAssistant: q }));
  assert.equal(receita.status, "needs_confirmation", "perguntou despesa e o modelo quer gravar receita");
  const outraCat = await run("my_hub_register", gasto(1500, { categoria: "Gasolina" }), ctx(fakeApi(), { confirmed: true, lastAssistant: q }));
  assert.equal(outraCat.status, "needs_confirmation");
  const outraDesc = await run("my_hub_register", gasto(1500, { descricao: "Joias" }), ctx(fakeApi(), { confirmed: true, lastAssistant: q }));
  assert.equal(outraDesc.status, "needs_confirmation");
});

test("o valor só conta na ÚLTIMA frase (pergunta), não em frases anteriores do Beto", async () => {
  const fala = "Anotei, chefe: despesa de R$ 1.500,00 em Mercado. Quer registrar mais alguma coisa?";
  const r = await run("my_hub_register", gasto(1500), ctx(fakeApi(), { confirmed: true, lastAssistant: fala }));
  assert.equal(r.status, "needs_confirmation");
});

test("um 'sim' libera UM registro alto por requisição", async () => {
  const q = "Registro uma despesa de R$ 1.500,00 (Mercado da semana) em Mercado?";
  const api = fakeApi(); const c = ctx(api, { confirmed: true, lastAssistant: q });
  assert.equal((await run("my_hub_register", gasto(1500), c)).status, "registered");
  const segundo = await run("my_hub_register", gasto(1500, { descricao: "Mercado da semana", conta: "PJ" }), c);
  assert.match(segundo.error ?? "", /alto/i);
  assert.equal(api.calls.filter((x) => x[0] === "register").length, 1);
});

test("ask_with não leva '?' nem ' ou ' da descrição (senão o 'sim' nunca confirma)", async () => {
  const r = await run("my_hub_register", gasto(1500, { descricao: "Uber ou 99?" }), ctx(fakeApi()));
  assert.ok(!/\bou\b/i.test(r.ask_with), r.ask_with);
  assert.equal((r.ask_with.match(/\?/g) ?? []).length, 1, "só o ? final");
});

test("desfazer na MESMA requisição apaga o registro que acabou de ser feito, não o antigo do navegador", async () => {
  const api = fakeApi(); const c = ctx(api, { undoIntent: true, undo: { path: "/antigo", resumo: "antigo", ts: NOW - 60_000 } });
  await run("my_hub_register", gasto(60), c);
  const r = await run("my_hub_undo", {}, c);
  assert.equal(r.status, "undone");
  assert.deepEqual(api.calls.at(-1), ["undo", "tx/1"], "o caminho do registro novo");
});

test("My Hub não respondeu a tempo (pode ter gravado): não duplica e manda conferir", async () => {
  const api = fakeApi({ registerResult: { ok: false, erro: "Não consegui falar com o My Hub agora.", incerto: true } });
  const c = ctx(api);
  const r = await run("my_hub_register", gasto(45), c);
  assert.equal(r.status, "uncertain");
  assert.match(r.message, /conferir/i);
  assert.equal(c.state.uncertain, true);
  const again = await run("my_hub_register", gasto(45), c);
  assert.match(again.error ?? "", /já foi/i);
  assert.equal(api.calls.filter((x) => x[0] === "register").length, 1);
});
