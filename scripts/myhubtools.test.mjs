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
  for (const frase of ["Registro uma despesa de R$ 1.500,00 (Mercado da semana) em Mercado?", "Chefe, registro uma despesa de R$ 1.500,00 (Mercado da semana) em Mercado?"]) {
    const ok = await run("my_hub_register", gasto(1500), ctx(fakeApi(), { confirmed: true, lastAssistant: frase }));
    assert.equal(ok.status, "registered", frase);
  }
  for (const frase of ["Anoto 1.500 no mercado?", "Registro uma despesa de R$ 1.500,00 em Mercado?", "registro uma despesa de 1500 reais, mercado da semana, em mercado?"]) {
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
  assert.match(again.error ?? "", /(já foi|incerto)/i);
  assert.equal(api.calls.filter((x) => x[0] === "register").length, 1);
});

/* ── Segunda revisão do My Hub ──────────────────────────────────────────── */

const Q = "Registro uma despesa de R$ 1.500,00 (Mercado da semana) em Mercado?";
const reg = (entrada, c, acao = "registrarTransacao") => run("my_hub_register", { acao, entrada }, c);

test("a trava varre a entrada INTEIRA: chaves desconhecidas, aninhadas e em arrays", async () => {
  for (const entrada of [
    { tipo: "despesa", valorTotal: 5000, descricao: "x" },
    { tipo: "despesa", custo: "5000", descricao: "x" },
    { tipo: "despesa", itens: [{ nome: "a", valor: 5000 }], descricao: "x" },
    { tipo: "despesa", detalhes: { preco: 5000 }, descricao: "x" },
    { tipo: "despesa", valorParcela: 2000, parcelas: 3, descricao: "x" },
    { tipo: "despesa", Valor: "5.000", descricao: "x" },
    { tipo: "despesa", descricao: "x", mistério: 5000 },
  ]) {
    const api = fakeApi();
    const r = await reg(entrada, ctx(api));
    assert.equal(r.status, "needs_confirmation", JSON.stringify(entrada));
    assert.equal(api.calls.length, 0, JSON.stringify(entrada));
  }
});

test("campos seguros com números altos não pedem confirmação (água, minutos, peso)", async () => {
  const api = fakeApi();
  assert.equal((await reg({ habito: "Beber água", quantidade: 2500 }, ctx(api), "registrarCheckinHabito")).status, "registered");
  assert.equal((await reg({ atividade: "Corrida", minutos: 1500, calorias: 3000 }, ctx(api), "registrarAtividade")).status, "registered");
});

test("cada campo de valor é normalizado NA MESMA CHAVE e vai como número (valor não vira valorEmReais fora de transação)", async () => {
  const api = fakeApi();
  await reg({ meta: "Viagem", valor: "500" }, ctx(api), "aportarMeta");
  assert.deepEqual(api.calls[0][2], { meta: "Viagem", valor: 500 });
  const api2 = fakeApi();
  await reg({ tipo: "despesa", valorEmCentavos: "150.000", descricao: "x" }, ctx(api2, { confirmed: true, lastAssistant: "Registro uma despesa de R$ 1.500,00 (x)?" }));
  assert.equal(api2.calls[0][2].valorEmCentavos, 150000, "centavos como inteiro");
  const api3 = fakeApi();
  await reg({ tipo: "despesa", valorEmReais: "45,505", descricao: "x" }, ctx(api3));
  assert.match((await reg({ tipo: "despesa", valorEmReais: "45,505", descricao: "x" }, ctx(fakeApi()))).error ?? "", /valor/i);
  const api4 = fakeApi();
  await reg({ tipo: "despesa", valorEmReais: 45.123, descricao: "x" }, ctx(api4));
  assert.equal(api4.calls[0][2].valorEmReais, 45.12, "arredonda para 2 casas");
});

test("dois campos de valor com números diferentes são RECUSADOS (o My Hub poderia usar o menor)", async () => {
  const api = fakeApi();
  const r = await reg({ tipo: "despesa", valorEmCentavos: 50000, valorEmReais: 5, descricao: "x" }, ctx(api));
  assert.match(r.error ?? "", /conflit/i);
  assert.equal(api.calls.length, 0);
  assert.equal((await reg({ tipo: "despesa", valorEmCentavos: 500, valorEmReais: 5, descricao: "x" }, ctx(api))).status, "registered", "mesmo valor nos dois: ok");
});

test("o tipo é o MESMO que o My Hub vai usar: 'credito' vira receita; 'transferencia' não passa em valor alto", async () => {
  const api = fakeApi();
  const cred = await reg({ tipo: "credito", valorEmReais: 1500, descricao: "Mercado da semana", categoria: "Mercado" }, ctx(api, { confirmed: true, lastAssistant: Q }));
  assert.equal(cred.status, "needs_confirmation", "perguntou DESPESA; o My Hub gravaria RECEITA");
  assert.match(cred.ask_with, /receita/i);
  const transf = await reg({ tipo: "transferencia", valorEmReais: 1500, descricao: "x" }, ctx(api));
  assert.match(transf.error ?? "", /tipo/i);
  assert.equal(api.calls.length, 0);
});

test("o 'sim' é preso à frase EXATA: ação, conta e data também precisam ter sido ditas", async () => {
  const base = { tipo: "despesa", valorEmReais: 1500, descricao: "Mercado da semana", categoria: "Mercado" };
  assert.equal((await reg({ ...base, conta: "PJ" }, ctx(fakeApi(), { confirmed: true, lastAssistant: Q }))).status, "needs_confirmation", "conta não citada");
  assert.equal((await reg({ ...base, data: "2026-09-01" }, ctx(fakeApi(), { confirmed: true, lastAssistant: Q }))).status, "needs_confirmation", "data não citada");
  assert.equal((await reg({ valorEmReais: 1500 }, ctx(fakeApi(), { confirmed: true, lastAssistant: Q }), "pagarFatura")).status, "needs_confirmation", "outra ação");
  const r = await reg({ ...base, conta: "PJ" }, ctx(fakeApi()));
  assert.match(r.ask_with, /conta PJ/);
  const ok = await reg({ ...base, conta: "PJ" }, ctx(fakeApi(), { confirmed: true, lastAssistant: r.ask_with }));
  assert.equal(ok.status, "registered");
});

test("sem descrição nem categoria na entrada, a pergunta com elas não confirma (a frase precisa ser a mesma)", async () => {
  const r = await reg({ tipo: "despesa", valorEmReais: 1500 }, ctx(fakeApi(), { confirmed: true, lastAssistant: Q }));
  assert.equal(r.status, "needs_confirmation");
});

test("palavra inteira: descrição 'Cafe' não confirma uma pergunta sobre 'Cafeteria'", async () => {
  const q = "Registro uma despesa de R$ 1.500,00 (Cafeteria) em Mercado?";
  const r = await reg({ tipo: "despesa", valorEmReais: 1500, descricao: "Cafe", categoria: "Mercado" }, ctx(fakeApi(), { confirmed: true, lastAssistant: q }));
  assert.equal(r.status, "needs_confirmation");
});

test("descrição com ponto ('Dr. Silva') não quebra a pergunta em duas frases", async () => {
  const entrada = { tipo: "despesa", valorEmReais: 1500, descricao: "Consulta Dr. Silva", categoria: "Saúde" };
  const r = await reg(entrada, ctx(fakeApi()));
  assert.equal(r.status, "needs_confirmation");
  const ok = await reg(entrada, ctx(fakeApi(), { confirmed: true, lastAssistant: r.ask_with }));
  assert.equal(ok.status, "registered");
});

test("anti-duplicata sobre a entrada NORMALIZADA: 45, '45' e 'valor: 45' são o mesmo registro", async () => {
  const api = fakeApi(); const c = ctx(api);
  await reg({ tipo: "despesa", valorEmReais: 45, descricao: "x" }, c);
  assert.match((await reg({ tipo: "despesa", valorEmReais: "45", descricao: "x" }, c)).error ?? "", /já foi/i);
  assert.match((await reg({ tipo: "despesa", valor: 45, descricao: "x" }, c)).error ?? "", /já foi/i);
  assert.equal(api.calls.filter((x) => x[0] === "register").length, 1);
});

test("depois de um registro INCERTO nenhum outro registro na mesma mensagem (nem com um campo a mais)", async () => {
  const api = fakeApi({ registerResult: { ok: false, erro: "Não consegui falar com o My Hub agora.", incerto: true } });
  const c = ctx(api);
  await reg({ tipo: "despesa", valorEmReais: 45, descricao: "x" }, c);
  const again = await reg({ tipo: "despesa", valorEmReais: 45, descricao: "x", conta: "Carteira" }, c);
  assert.match(again.error ?? "", /incerto/i);
  assert.equal(api.calls.filter((x) => x[0] === "register").length, 1);
});

test("desfazer duas vezes na mesma mensagem não cai no registro antigo do navegador", async () => {
  const api = fakeApi(); const c = ctx(api, { undoIntent: true, undo: { path: "/antigo", resumo: "antigo", ts: NOW - 60_000 } });
  await reg({ tipo: "despesa", valorEmReais: 60, descricao: "x" }, c);
  assert.equal((await run("my_hub_undo", {}, c)).status, "undone");
  assert.equal((await run("my_hub_undo", {}, c)).status, "nothing_to_undo");
  assert.deepEqual(api.calls.filter((x) => x[0] === "undo"), [["undo", "tx/1"]]);
});

test("valor absurdo é recusado e não quebra a frase de confirmação", async () => {
  for (const v of [1e21, 1e9, "99999999999"]) {
    const r = await reg({ tipo: "despesa", valorEmReais: v, descricao: "x" }, ctx(fakeApi()));
    assert.match(r.error ?? "", /valor/i, String(v));
  }
});

test("o 'registro alto liberado' só conta se o My Hub realmente registrou (recusa não consome o 'sim')", async () => {
  const api = fakeApi({ registerResult: { ok: false, erro: "Qual conta: Carteira ou PJ?" } });
  const c = ctx(api, { confirmed: true, lastAssistant: Q });
  assert.equal((await reg({ tipo: "despesa", valorEmReais: 1500, descricao: "Mercado da semana", categoria: "Mercado" }, c)).status, "failed");
  assert.notEqual(c.state.highDone, true);
});

/* ── Terceira revisão do My Hub ─────────────────────────────────────────── */

test("campo de valor que é array ou objeto é RECUSADO; array de números altos em chave desconhecida é dinheiro", async () => {
  for (const entrada of [
    { tipo: "despesa", valorEmReais: [5000], descricao: "x" },
    { tipo: "despesa", valorEmReais: ["5000"], descricao: "x" },
    { tipo: "despesa", valor: { reais: 5000 }, descricao: "x" },
  ]) {
    const api = fakeApi();
    assert.match((await reg(entrada, ctx(api))).error ?? "", /valor/i, JSON.stringify(entrada));
    assert.equal(api.calls.length, 0);
  }
  const api = fakeApi();
  assert.match((await reg({ tipo: "despesa", valores: [5000], descricao: "x" }, ctx(api))).error ?? "", /valor/i, "chave de valor com array é recusada");
  assert.equal((await reg({ tipo: "despesa", misterio: [5000], descricao: "x" }, ctx(api))).status, "needs_confirmation", "array de números altos em chave desconhecida");
});

test("campos de TEXTO e booleanos cujas chaves parecem dinheiro NÃO quebram registros normais", async () => {
  for (const extra of [{ formaDePagamento: "crédito" }, { tipoPagamento: "pix" }, { pagamentoRecorrente: true }, { parcelado: false },
    { totalParcelas: 12 }, { descricaoPagamento: "Pix" }, { habitoId: 1234 }, { projetoId: 99999 }]) {
    const api = fakeApi();
    const r = await reg({ tipo: "despesa", valorEmReais: 100, descricao: "x", ...extra }, ctx(api));
    assert.equal(r.status, "registered", JSON.stringify(extra));
  }
});

test("quantidade × preço vale como o total (100 ações a R$ 35 pedem confirmação)", async () => {
  const api = fakeApi();
  const r = await reg({ ativo: "PETR4", quantidade: 100, precoUnitario: 35 }, ctx(api), "registrarInvestimento");
  assert.equal(r.status, "needs_confirmation");
  assert.match(r.ask_with, /3\.500,00/);
  assert.equal((await reg({ ativo: "PETR4", quantidade: 10, precoUnitario: 35 }, ctx(fakeApi()), "registrarInvestimento")).status, "registered");
});

test("número alto em chave de texto conhecida (descricao: '2026') não vira dinheiro; número desconhecido junto de valor estrito é CONFLITO", async () => {
  const api = fakeApi();
  assert.equal((await reg({ tipo: "despesa", valorEmReais: 45, descricao: "2026", categoria: "Mercado" }, ctx(api))).status, "registered");
  const r = await reg({ tipo: "despesa", valorEmReais: 45, v: "5000", descricao: "x" }, ctx(fakeApi()));
  assert.match(r.error ?? "", /desconhecido|conflit/i);
});

test("negativos e chaves em inglês também são dinheiro; objeto fundo demais é recusado", async () => {
  assert.match((await reg({ tipo: "despesa", value: -5000, descricao: "x" }, ctx(fakeApi()))).error ?? "", /valor/i);
  assert.equal((await reg({ tipo: "despesa", cost: "5000", descricao: "x" }, ctx(fakeApi()))).status, "needs_confirmation");
  let deep = { valorEmReais: 5000 };
  for (let i = 0; i < 8; i++) deep = { n: deep };
  assert.match((await reg({ tipo: "despesa", descricao: "x", ...deep }, ctx(fakeApi()))).error ?? "", /aninhad/i);
});

test("a data vai na pergunta como dd/mm/aaaa (o modelo erra menos do que com ISO)", async () => {
  const r = await reg({ tipo: "despesa", valorEmReais: 1500, descricao: "Mercado", categoria: "Mercado", data: "2026-10-05" }, ctx(fakeApi()));
  assert.match(r.ask_with, /05\/10\/2026/);
  const ok = await reg({ tipo: "despesa", valorEmReais: 1500, descricao: "Mercado", categoria: "Mercado", data: "2026-10-05" }, ctx(fakeApi(), { confirmed: true, lastAssistant: r.ask_with }));
  assert.equal(ok.status, "registered");
});

test("pergunta negada ('Não registro uma despesa de R$ 1.500,00?') + 'sim' NÃO grava", async () => {
  const entrada = { tipo: "despesa", valorEmReais: 1500, descricao: "Mercado da semana", categoria: "Mercado" };
  const r = await reg(entrada, ctx(fakeApi(), { confirmed: true, lastAssistant: "Não registro uma despesa de R$ 1.500,00 (Mercado da semana) em Mercado?" }));
  assert.equal(r.status, "needs_confirmation");
});
