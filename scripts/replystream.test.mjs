import test from "node:test";
import assert from "node:assert/strict";
import { ReplyStream } from "../lib/replystream.ts";

/* Alimenta o texto em pedaços de `n` caracteres e junta os eventos. */
function run(text, n = 3) {
  const rs = new ReplyStream();
  const events = [];
  for (let i = 0; i < text.length; i += n) events.push(...rs.push(text.slice(i, i + n)));
  const end = rs.finish();
  events.push(...end.events);
  return { events, full: end.full, held: end.held };
}
const sentences = (r) => r.events.filter((e) => e.type === "sentence").map((e) => e.text);
const tags = (r) => r.events.filter((e) => e.type === "tag").map((e) => e.name);

test("tag de emoção do início sai como evento e não vira texto", () => {
  const r = run("[emo:alegre] Fechou, chefe. Tudo certo por aqui.");
  assert.deepEqual(tags(r), ["alegre"]);
  assert.deepEqual(sentences(r), ["Fechou, chefe.", "Tudo certo por aqui."]);
  assert.equal(r.held, false);
});

test("o resultado é o mesmo qualquer que seja o tamanho dos pedaços", () => {
  const text = "[emo:neutro] Primeira frase completa aqui. Segunda frase também termina bem! E a terceira pergunta algo?";
  const base = sentences(run(text, 1000));
  for (const n of [1, 2, 3, 5, 7, 11, 40]) assert.deepEqual(sentences(run(text, n)), base, `n=${n}`);
  assert.equal(base.length, 3);
});

test("a primeira frase sai assim que fecha, sem esperar o resto", () => {
  const rs = new ReplyStream();
  let out = [];
  out.push(...rs.push("[emo:neutro] Claro, chefe, posso te ajudar com isso."));
  assert.equal(out.filter((e) => e.type === "sentence").length, 0, "ainda sem espaço depois do ponto");
  out.push(...rs.push(" E"));
  assert.deepEqual(out.filter((e) => e.type === "sentence").map((e) => e.text), ["Claro, chefe, posso te ajudar com isso."]);
});

test("tag de ação no início segura tudo (caminho antigo)", () => {
  const r = run('[emo:neutro] [SPOTIFY:{"action":"pause"}] Ok.');
  assert.equal(r.held, true);
  assert.deepEqual(sentences(r), []);
  assert.equal(r.full, '[emo:neutro] [SPOTIFY:{"action":"pause"}] Ok.');
});

test("tag de ação antes da de emoção também segura", () => {
  const r = run('[SPOTIFY:{"action":"next"}] [emo:alegre] Vai.');
  assert.equal(r.held, true);
  assert.deepEqual(sentences(r), []);
});

test("[NEEDTOOLS] segura (o servidor normalmente nem deixa chegar)", () => {
  const r = run("[NEEDTOOLS]");
  assert.equal(r.held, true);
});

test("sem tag nenhuma: fala normalmente", () => {
  const r = run("Bom, isso depende de alguns fatores importantes. Vamos por partes.");
  assert.deepEqual(tags(r), []);
  assert.deepEqual(sentences(r), ["Bom, isso depende de alguns fatores importantes.", "Vamos por partes."]);
});

test("abreviação e número com ponto não cortam a frase", () => {
  const r = run("[emo:neutro] O Dr. Silva pagou 3.5 mil reais pelo serviço. Depois foi embora.");
  assert.deepEqual(sentences(r), ["O Dr. Silva pagou 3.5 mil reais pelo serviço.", "Depois foi embora."]);
});

test("a última frase sem ponto final sai no finish", () => {
  const r = run("[emo:neutro] Primeira frase terminada. Última frase sem ponto");
  assert.deepEqual(sentences(r), ["Primeira frase terminada.", "Última frase sem ponto"]);
});

test("primeira frase longa sem ponto corta na vírgula para falar mais cedo", () => {
  const long = "[emo:neutro] Olha, chefe, pensando no que você me contou sobre o cliente e sobre o prazo apertado da entrega, eu iria por outro caminho porque o risco é alto.";
  const rs = new ReplyStream();
  const early = rs.push(long.slice(0, 120)).filter((e) => e.type === "sentence");
  assert.equal(early.length, 1, "deve soltar a primeira parte antes do fim");
  assert.ok(early[0].text.endsWith(","), early[0].text);
  const rest = [...rs.push(long.slice(120)), ...rs.finish().events].filter((e) => e.type === "sentence").map((e) => e.text);
  assert.equal([early[0].text, ...rest].join(" ").replace(/\s+/g, " "), long.replace("[emo:neutro] ", ""));
});

test("tag de emoção no meio do texto é removida, não falada", () => {
  const r = run("[emo:neutro] Poxa, que pena mesmo. [emo:triste] Sinto muito por isso.");
  for (const s of sentences(r)) assert.ok(!s.includes("emo"), s);
  assert.deepEqual(sentences(r), ["Poxa, que pena mesmo.", "Sinto muito por isso."]);
});

test("tag de ação no meio do texto avisa 'hold tardio' e para de emitir frases", () => {
  const r = run('[emo:neutro] Beleza, já vou fazer isso agora. [SPOTIFY:{"action":"pause"}] Pronto.');
  const hold = r.events.find((e) => e.type === "hold");
  assert.ok(hold && hold.late === true);
  assert.deepEqual(sentences(r), ["Beleza, já vou fazer isso agora."]);
  assert.equal(r.held, true);
});

test("resposta que é só a tag de emoção não gera frase", () => {
  const r = run("[emo:alegre]");
  assert.deepEqual(tags(r), ["alegre"]);
  assert.deepEqual(sentences(r), []);
  assert.equal(r.held, false);
});

test("texto vazio não gera nada", () => {
  const r = run("");
  assert.deepEqual(r.events, []);
  assert.equal(r.full, "");
});

test("começa com colchete que não é tag (ex.: [1]) e fala normalmente", () => {
  const r = run("[1] é a opção mais segura que eu vejo aqui. Então vai nela.");
  assert.deepEqual(sentences(r), ["[1] é a opção mais segura que eu vejo aqui.", "Então vai nela."]);
});

test("full guarda o texto bruto completo (tags incluídas) para o histórico", () => {
  const text = "[emo:alegre] Tudo certo. Pode seguir.";
  assert.equal(run(text).full, text);
});

test("frase muito longa sem pontuação é cortada em algum ponto, sem perder texto", () => {
  const words = Array.from({ length: 80 }, (_, i) => `palavra${i}`).join(" ");
  const r = run(`[emo:neutro] ${words}`);
  const s = sentences(r);
  assert.ok(s.length >= 2, "deve cortar");
  assert.equal(s.join(" "), words);
});

test("[NEEDTOOLS] depois do texto também é hold tardio e nunca vira frase falada", () => {
  const r = run("[emo:neutro] Claro, chefe, deixa comigo. [NEEDTOOLS]");
  const hold = r.events.find((e) => e.type === "hold");
  assert.ok(hold && hold.late === true);
  assert.deepEqual(sentences(r), ["Claro, chefe, deixa comigo."]);
  assert.equal(r.held, true);
});

test("[NEEDTOOLS] com sublinhado ou minúsculo logo no começo segura tudo", () => {
  for (const t of ["[emo:neutro] [NEED_TOOLS]", "[needtools]", "[emo:alegre][NeedTools] ok"]) {
    const r = run(t);
    assert.equal(r.held, true, t);
    assert.deepEqual(sentences(r), [], t);
  }
});

test("[NEEDTOOLS] cortado em pedaços de 1 caractere", () => {
  const r = run("[emo:neutro] Beleza, pode deixar comigo. [NEEDTOOLS]", 1);
  assert.equal(r.held, true);
  assert.ok(sentences(r).every((s) => !s.includes("NEED")));
});
