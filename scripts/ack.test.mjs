import test from "node:test";
import assert from "node:assert/strict";
import { ackKind } from "../lib/ack.ts";

const S = (o = {}) => ({ calendar: false, myhub: false, memory: false, content: false, ...o });

test("cada ferramenta sozinha dá o seu tipo", () => {
  assert.equal(ackKind(S({ content: true })), "conteudo");
  assert.equal(ackKind(S({ calendar: true })), "agenda");
  assert.equal(ackKind(S({ myhub: true })), "myhub");
  assert.equal(ackKind(S({ memory: true })), "memoria");
  assert.equal(ackKind(S()), "geral");
});

test("prioridade: conteudo > agenda > myhub > memoria", () => {
  assert.equal(ackKind(S({ content: true, calendar: true, myhub: true, memory: true })), "conteudo");
  assert.equal(ackKind(S({ calendar: true, myhub: true })), "agenda");
  assert.equal(ackKind(S({ myhub: true, memory: true })), "myhub");
  assert.equal(ackKind({ calendar: false, myhub: false, memory: true }), "memoria");   // content ausente
});

import { ACK_PHRASES, ACK_ALL, ackPhrase, turnAck } from "../lib/ack.ts";

const U = (content) => [{ role: "user", content }];

test("frases curtas do navegador: as mesmas do serviço voice/, todas curtas", () => {
  for (const kind of ["conteudo", "agenda", "myhub", "memoria", "geral"]) {
    assert.ok(ACK_PHRASES[kind].length > 0, kind);
    for (const f of ACK_PHRASES[kind]) assert.ok(f.split(/\s+/).length <= 6, f);
  }
  assert.ok(ACK_PHRASES.agenda.includes("Deixa eu ver a agenda."));
  assert.equal(new Set(ACK_ALL).size, ACK_ALL.length);   // sem repetição: cada frase é gerada uma vez só
});

test("ackPhrase faz rodízio dentro do tipo", () => {
  const n = ACK_PHRASES.agenda.length;
  assert.equal(ackPhrase("agenda", 0), ACK_PHRASES.agenda[0]);
  assert.equal(ackPhrase("agenda", n), ACK_PHRASES.agenda[0]);
  assert.equal(ackPhrase("agenda", 1), ACK_PHRASES.agenda[1 % n]);
});

test("turnAck: pedido que roda ferramenta ganha frase do tipo certo", () => {
  assert.equal(turnAck(U("o que eu tenho na agenda amanhã?")), "agenda");
});

test("turnAck: conversa simples não ganha frase (o stream já começa rápido)", () => {
  assert.equal(turnAck(U("me conta uma curiosidade sobre o espaço")), null);
});
