import test from "node:test";
import assert from "node:assert/strict";
import { SharedPlayer, SILENT_WAV } from "../lib/audioplayer.ts";

/* Elemento de áudio falso: guarda src, conta play/pause/load e deixa o teste disparar os eventos. */
function fakeEl({ reject = false } = {}) {
  const el = {
    src: "", plays: [], paused: 0, loads: 0, removed: 0,
    onplaying: null, onended: null, onerror: null,
    play() { el.plays.push(el.src); return reject ? Promise.reject(new Error("NotAllowedError")) : Promise.resolve(); },
    pause() { el.paused++; },
    load() { el.loads++; },
    removeAttribute(name) { if (name === "src") { el.src = ""; el.removed++; } },
  };
  return el;
}
const tick = () => new Promise((r) => setTimeout(r, 0));

test("unlock toca o silêncio no mesmo elemento que depois toca as falas (é o que o Safari exige)", async () => {
  let made = 0;
  const el = fakeEl();
  const p = new SharedPlayer(() => { made++; return el; });
  p.unlock();
  assert.deepEqual(el.plays, [SILENT_WAV]);
  p.play("blob:a", { onPlaying() {}, onEnd() {} });
  p.play("blob:b", { onPlaying() {}, onEnd() {} });
  assert.deepEqual(el.plays, [SILENT_WAV, "blob:a", "blob:b"]);
  assert.equal(made, 1);
  assert.equal(p.unlocked, true);
});

test("sem unlock, play cria o elemento na hora (Chrome segue funcionando)", () => {
  const el = fakeEl();
  const p = new SharedPlayer(() => el);
  assert.equal(p.unlocked, false);
  p.play("blob:a", { onPlaying() {}, onEnd() {} });
  assert.deepEqual(el.plays, ["blob:a"]);
});

test("eventos chamam os ganchos da fala atual; onEnd uma vez só", async () => {
  const el = fakeEl();
  const p = new SharedPlayer(() => el);
  let playing = 0, ended = 0;
  p.play("blob:a", { onPlaying: () => playing++, onEnd: () => ended++ });
  el.onplaying();
  el.onended();
  el.onerror?.();
  assert.equal(playing, 1);
  assert.equal(ended, 1);
});

test("play recusado (autoplay bloqueado) encerra a fala", async () => {
  const el = fakeEl({ reject: true });
  const p = new SharedPlayer(() => el);
  let ended = 0;
  p.play("blob:a", { onPlaying() {}, onEnd: () => ended++ });
  await tick();
  assert.equal(ended, 1);
});

test("fala nova encerra a anterior, e eventos atrasados da anterior não atingem a nova", async () => {
  const el = fakeEl();
  const p = new SharedPlayer(() => el);
  const log = [];
  p.play("blob:a", { onPlaying: () => log.push("a+"), onEnd: () => log.push("a.") });
  const oldEnded = el.onended;
  p.play("blob:b", { onPlaying: () => log.push("b+"), onEnd: () => log.push("b.") });
  oldEnded?.();             // evento da frase a chegando tarde
  el.onplaying();
  assert.deepEqual(log, ["a.", "b+"]);
});

test("stop da fala atual silencia sem disparar erro; stop de uma fala antiga não corta a atual", () => {
  const el = fakeEl();
  const p = new SharedPlayer(() => el);
  const log = [];
  const a = p.play("blob:a", { onPlaying() {}, onEnd: () => log.push("a.") });
  const b = p.play("blob:b", { onPlaying() {}, onEnd: () => log.push("b.") });
  a.stop();
  assert.equal(el.src, "blob:b");
  b.stop();
  assert.equal(el.src, "");
  assert.equal(el.removed, 1);          // removeAttribute + load, não src = "" (que dispara erro)
  assert.equal(el.loads, 1);
  assert.equal(el.onerror, null);
  assert.deepEqual(log, ["a.", "b."]);
});

test("stopAll encerra o que estiver tocando", () => {
  const el = fakeEl();
  const p = new SharedPlayer(() => el);
  let ended = 0;
  p.play("blob:a", { onPlaying() {}, onEnd: () => ended++ });
  p.stopAll();
  p.stopAll();
  assert.equal(ended, 1);
  assert.equal(el.src, "");
});
