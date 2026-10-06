import test from "node:test";
import assert from "node:assert/strict";
import { planTurn } from "../lib/turnplan.ts";

const u = (content) => ({ role: "user", content });
const a = (content) => ({ role: "assistant", content });
const ON = { myhubWrite: true, memory: true };

test("conversa solta: modo chat, sem ferramentas", () => {
  assert.deepEqual(planTurn([u("como você está hoje de manhã")], ON), { mode: "chat", sets: null });
});

test("agenda: modo completo com o conjunto de agenda", () => {
  const p = planTurn([u("marca reunião com o João amanhã às 15h")], ON);
  assert.equal(p.mode, "full");
  assert.equal(p.sets.calendar, true);
});

test("gasto: conjunto do My Hub só se a escrita estiver configurada", () => {
  assert.equal(planTurn([u("gastei 40 reais no mercado")], ON).sets.myhub, true);
  const off = planTurn([u("gastei 40 reais no mercado")], { myhubWrite: false, memory: true });
  assert.equal(off.mode, "full");
  assert.equal(off.sets?.myhub ?? false, false);
});

test("memória desligada não liga o conjunto de memória", () => {
  const p = planTurn([u("lembra que meu carro é um civic")], { myhubWrite: true, memory: false });
  assert.equal(p.sets?.memory ?? false, false);
});

test("pedido completo sem conjunto (música): modo completo, sem ferramentas nativas", () => {
  assert.deepEqual(planTurn([u("toca um rock aí")], ON), { mode: "full", sets: null });
});

test("forceFull força o modo completo mesmo em conversa", () => {
  assert.equal(planTurn([u("como você está hoje de manhã")], ON, true).mode, "full");
});

test("confirmação curta depois de pergunta de agenda segue no modo completo", () => {
  const p = planTurn([u("cancela a reunião de amanhã"), a("[emo:neutro] Cancelo a Reunião X de amanhã às 10h?"), u("pode")], ON);
  assert.equal(p.mode, "full");
});

test("conteúdo (vídeo, episódio, roteiro): modo completo com a ferramenta do plano", () => {
  const C = { ...ON, content: true };
  for (const t of ["e aí, sobre o meu vídeo, o que eu preciso gravar?", "me explica o episódio 2", "qual o roteiro do ep 3",
    "o que eu posto hoje no instagram", "como tá meu plano de conteúdo"]) {
    const p = planTurn([u(t)], C);
    assert.equal(p.mode, "full", t);
    assert.equal(p.sets?.content, true, t);
  }
  assert.equal(planTurn([u("me explica o episódio 2")], ON).sets?.content ?? false, false, "sem My Hub configurado não liga");
  assert.equal(planTurn([u("como você está hoje de manhã")], C).sets, null);
});
