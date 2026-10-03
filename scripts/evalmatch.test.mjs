import test from "node:test";
import assert from "node:assert/strict";
import { matchCase, majority, score, isDrop, notRun, exitCode, validateCases } from "./eval/match.mjs";

const R = (o = {}) => ({ toolCalls: [], text: "", needTools: false, ...o });
const call = (name, args) => ({ name, args });

test("ferramenta certa sem conferir args", () => {
  assert.equal(matchCase({ espera: { ferramenta: "create_event" } }, R({ toolCalls: [call("create_event", {})] })).ok, true);
});

test("ferramenta errada explica o que veio", () => {
  const m = matchCase({ espera: { ferramenta: "my_hub_register" } }, R({ toolCalls: [call("memory_save", {})] }));
  assert.equal(m.ok, false);
  assert.match(m.motivo, /esperava my_hub_register, veio memory_save/);
});

test("args: exato, regex, intervalo e caminho com ponto", () => {
  const caso = { espera: { ferramenta: "my_hub_register", args: { acao: "registrarTransacao", "entrada.valor": { min: 39, max: 41 }, "entrada.descricao": "/mercado/i" } } };
  assert.equal(matchCase(caso, R({ toolCalls: [call("my_hub_register", { acao: "registrarTransacao", entrada: { valor: 40, descricao: "Mercado" } })] })).ok, true);
  assert.equal(matchCase(caso, R({ toolCalls: [call("my_hub_register", { acao: "registrarTransacao", entrada: { valor: 400, descricao: "Mercado" } })] })).ok, false);
});

test("número vindo como texto vale; vazio e null nunca batem", () => {
  const caso = { espera: { ferramenta: "x", args: { v: 35, w: { min: 1 } } } };
  assert.equal(matchCase(caso, R({ toolCalls: [call("x", { v: "35", w: "2" })] })).ok, true);
  assert.equal(matchCase(caso, R({ toolCalls: [call("x", { v: "", w: null })] })).ok, false);
});

test("args com JSON inválido (null) reprova só quando o caso confere args", () => {
  assert.equal(matchCase({ espera: { ferramenta: "x" } }, R({ toolCalls: [call("x", null)] })).ok, true);
  assert.equal(matchCase({ espera: { ferramenta: "x", args: { a: 1 } } }, R({ toolCalls: [call("x", null)] })).ok, false);
});

test("várias chamadas: basta uma bater", () => {
  const r = R({ toolCalls: [call("list_events", {}), call("create_event", { title: "Dentista" })] });
  assert.equal(matchCase({ espera: { ferramenta: "create_event", args: { title: "/dentista/i" } } }, r).ok, true);
});

test("nunca reprova mesmo com a esperada presente", () => {
  const r = R({ toolCalls: [call("my_hub_register", {}), call("memory_save", {})] });
  const m = matchCase({ espera: { ferramenta: "my_hub_register" }, nunca: ["memory_save"] }, r);
  assert.equal(m.ok, false);
  assert.match(m.motivo, /memory_save/);
});

test("nenhumaFerramenta: texto sim; ferramenta, NEEDTOOLS ou vazio não", () => {
  const caso = { espera: { nenhumaFerramenta: true } };
  assert.equal(matchCase(caso, R({ text: "[emo:alegre] Tudo certo!" })).ok, true);
  assert.equal(matchCase(caso, R({ text: "ok", toolCalls: [call("x", {})] })).ok, false);
  assert.equal(matchCase(caso, R({ text: "[NEEDTOOLS]", needTools: true })).ok, false);
  assert.equal(matchCase(caso, R({ text: "  " })).ok, false);
});

test("needTools", () => {
  assert.equal(matchCase({ espera: { needTools: true } }, R({ text: "[emo:neutro] [NEEDTOOLS]", needTools: true })).ok, true);
  assert.equal(matchCase({ espera: { needTools: true } }, R({ text: "Claro!" })).ok, false);
});

test("tag com emoção antes e conteúdo por regex", () => {
  const r = R({ text: "[emo:animado] [SPOTIFY:{\"action\":\"play\",\"query\":\"Drake\"}] Vai." });
  assert.equal(matchCase({ espera: { tag: "SPOTIFY", conteudo: "/drake/i" } }, r).ok, true);
  assert.equal(matchCase({ espera: { tag: "SPOTIFY", conteudo: "/pause/" } }, r).ok, false);
  assert.equal(matchCase({ espera: { tag: "TIMER" } }, r).ok, false);
});

test("majority: maioria aprova, empate reprova", () => {
  assert.equal(majority([{ ok: true }, { ok: false, motivo: "a" }, { ok: true }]).ok, true);
  assert.equal(majority([{ ok: true }, { ok: false, motivo: "a" }]).ok, false);
});

test("score ignora erros; queda acima de 5 pontos; não rodou acima de 20% de erro", () => {
  const rows = [
    { area: "agenda", status: "ok" }, { area: "agenda", status: "falhou" },
    { area: "myhub", status: "ok" }, { area: "myhub", status: "ok" }, { area: "myhub", status: "erro" },
  ];
  const sc = score(rows);
  assert.equal(sc.total, 0.75);
  assert.deepEqual(sc.areas, { agenda: 0.5, myhub: 1 });
  assert.equal(sc.erro, 1);
  assert.equal(isDrop(sc, { total: 0.81 }), true);
  assert.equal(isDrop(sc, { total: 0.80 }), false);
  assert.equal(isDrop(sc, undefined), false);
  assert.equal(notRun(sc), false);
  assert.equal(notRun(score([{ area: "a", status: "erro" }, { area: "a", status: "ok" }])), true);
  assert.equal(exitCode(sc, { total: 0.95 }), 1);
  assert.equal(exitCode(sc, { total: 0.75 }), 0);
  assert.equal(exitCode(score([{ area: "a", status: "erro" }]), { total: 0.9 }), 2);
});

test("validateCases acha id repetido, área inválida, espera ambígua, regex quebrada e ferramenta inexistente", () => {
  const ok = { id: "a", area: "agenda", conversa: [{ role: "user", content: "x" }], espera: { ferramenta: "create_event" } };
  assert.deepEqual(validateCases([ok], ["create_event"]), []);
  const erros = validateCases([
    ok, { ...ok },
    { ...ok, id: "b", area: "nada" },
    { ...ok, id: "c", espera: { ferramenta: "create_event", needTools: true } },
    { ...ok, id: "d", espera: { tag: "SPOTIFY", conteudo: "/(/" } },
    { ...ok, id: "e", espera: { ferramenta: "nao_existe" } },
    { ...ok, id: "f", conversa: [] },
    { ...ok, id: "g", repete: 5 },
  ], ["create_event"]);
  for (const id of ["a", "b", "c", "d", "e", "f", "g"]) assert.ok(erros.some((e) => e.startsWith(id + ":")), `faltou erro de ${id}: ${erros}`);
});

test("tag segue o parser de produção: [TAG:{json}] exato, com JSON válido", () => {
  assert.equal(matchCase({ espera: { tag: "SPOTIFY" } }, R({ text: "[spotify: play drake] Vai." })).ok, false);
  assert.equal(matchCase({ espera: { tag: "SPOTIFY" } }, R({ text: "[SPOTIFY: play drake] Vai." })).ok, false);
  assert.equal(matchCase({ espera: { tag: "SPOTIFY" } }, R({ text: "[SPOTIFY:{action:play}] Vai." })).ok, false);
  assert.equal(matchCase({ espera: { tag: "SPOTIFY" } }, R({ text: "[emo:neutro] [SPOTIFY:{\"action\":\"pause\"}] Ok." })).ok, true);
});

test("número: espaço, array e objeto não viram número", () => {
  const caso = { espera: { ferramenta: "x", args: { v: { min: 0 } } } };
  for (const v of [" ", [35], [], {}, "  \n"]) assert.equal(matchCase(caso, R({ toolCalls: [call("x", { v })] })).ok, false, JSON.stringify(v));
  assert.equal(matchCase({ espera: { ferramenta: "x", args: { v: 35 } } }, R({ toolCalls: [call("x", { v: [35] })] })).ok, false);
});
