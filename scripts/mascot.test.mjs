import test from "node:test";
import assert from "node:assert/strict";
import { EMOTIONS } from "../lib/emotion.ts";
import { MASCOT_EMOTIONS, EMO, createGhost, WAVE_S, NOTIFY_S } from "../components/mascot/ghost.ts";
import { EMOTION_TO_MASCOT, mascotEmotion, mascotTalking, shouldHop } from "../components/mascot/mapping.ts";

/* Todo número de posição/escala/rotação da cena tem que ser finito. */
function assertFinite(ghost, label) {
  ghost.group.updateMatrixWorld(true);
  ghost.group.traverse(o => {
    for (const v of [...o.position.toArray(), ...o.scale.toArray(), o.rotation.x, o.rotation.y, o.rotation.z]) {
      assert.ok(Number.isFinite(v), `${label}: ${o.name} tem valor não finito`);
    }
  });
}

const run = (ghost, seconds, t0 = 0) => {
  let now = t0;
  for (let i = 0; i < seconds * 60; i++) { now += 1000 / 60; ghost.update(1 / 60, now); }
  return now;
};

test("toda emoção do app tem expressão no mascote", () => {
  for (const e of EMOTIONS) assert.ok(MASCOT_EMOTIONS.includes(EMOTION_TO_MASCOT[e]), e);
  for (const e of MASCOT_EMOTIONS) assert.ok(EMO[e], `preset de ${e}`);
});

test("estado de voz manda na expressão; emoção só vale no speaking", () => {
  assert.equal(mascotEmotion("wake", "bravo", false), "dormindo");
  assert.equal(mascotEmotion("wake", "neutro", true), "dj");
  assert.equal(mascotEmotion("listening", "triste", true), "ouvindo");
  assert.equal(mascotEmotion("thinking", "alegre", false), "pensando");
  assert.equal(mascotEmotion("speaking", "alegre", true), "feliz");
  assert.equal(mascotEmotion("speaking", "sarcastico", false), "sarcastico");
  assert.equal(mascotEmotion("speaking", "nervoso", false), "nervoso");
});

test("boca só mexe falando com o áudio tocando", () => {
  assert.equal(mascotTalking("speaking", true), true);
  assert.equal(mascotTalking("speaking", false), false);
  assert.equal(mascotTalking("thinking", true), false);
});

test("pulinho do animado só na entrada da fala", () => {
  assert.equal(shouldHop(null, { state: "speaking", emotion: "animado" }), true);
  assert.equal(shouldHop({ state: "thinking", emotion: "neutro" }, { state: "speaking", emotion: "animado" }), true);
  assert.equal(shouldHop({ state: "speaking", emotion: "animado" }, { state: "speaking", emotion: "animado" }), false);
  assert.equal(shouldHop({ state: "speaking", emotion: "neutro" }, { state: "speaking", emotion: "alegre" }), false);
});

test("nenhuma expressão nem transição entre expressões gera NaN", () => {
  const ghost = createGhost();
  let now = 0;
  for (const a of MASCOT_EMOTIONS) {
    for (const b of MASCOT_EMOTIONS) {
      ghost.setEmotion(a); now = run(ghost, 0.3, now);
      ghost.setEmotion(b); ghost.talk(true); now = run(ghost, 0.3, now);
      ghost.talk(false);
      assertFinite(ghost, `${a} → ${b}`);
    }
  }
  ghost.dispose();
});

test("aceno e notificação terminam sozinhos e a expressão volta", () => {
  const ghost = createGhost();
  ghost.setEmotion("triste");
  ghost.wave();
  assert.equal(ghost.busy.wave, true);
  let now = run(ghost, WAVE_S + 0.2);
  assert.equal(ghost.busy.wave, false);
  ghost.notify();
  ghost.wave();   // notificação tem prioridade: o aceno não começa no meio dela
  assert.deepEqual(ghost.busy, { wave: false, notify: true });
  now = run(ghost, NOTIFY_S + 0.2, now);
  assert.deepEqual(ghost.busy, { wave: false, notify: false });
  assert.equal(ghost.emotion, "triste");
  assertFinite(ghost, "depois do aceno/notificação");
  ghost.dispose();
});

test("movimento reduzido: sem flutuação nem pulo, o corpo fica parado na altura de repouso", () => {
  const ghost = createGhost();
  ghost.setReducedMotion(true);
  ghost.setEmotion("feliz");
  let now = run(ghost, 8);
  const ys = [];
  for (let i = 0; i < 120; i++) { now += 1000 / 60; ghost.update(1 / 60, now); ys.push(ghost.group.position.y); }
  assert.ok(Math.max(...ys) - Math.min(...ys) < 1e-6);
  ghost.dispose();
});
