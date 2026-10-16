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
