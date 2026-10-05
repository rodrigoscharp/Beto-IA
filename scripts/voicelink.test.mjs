import test from "node:test";
import assert from "node:assert/strict";
import { micConstraints, parseServerMessage } from "../lib/voicelink.ts";

test("mensagens do servidor: cada tipo", () => {
  assert.deepEqual(parseServerMessage({ type: "emotion", emotion: "Alegre" }), { type: "emotion", emotion: "alegre" });
  assert.deepEqual(parseServerMessage({ type: "action", tag: "SPOTIFY", payload: { action: "play", query: "Drake" } }),
    { type: "action", tag: "SPOTIFY", payload: { action: "play", query: "Drake" } });
  assert.deepEqual(parseServerMessage({ type: "action", tag: "TIMER" }), { type: "action", tag: "TIMER", payload: {} });
  assert.deepEqual(parseServerMessage({ type: "state", state: "listening" }), { type: "state", state: "listening" });
  assert.deepEqual(parseServerMessage({ type: "ignored", text: "papo da sala" }), { type: "ignored", text: "papo da sala" });
  assert.deepEqual(parseServerMessage({ type: "needs_login", service: "google" }), { type: "needs_login", service: "google" });
});

test("mensagens inválidas devolvem null", () => {
  assert.equal(parseServerMessage(null), null);
  assert.equal(parseServerMessage("x"), null);
  assert.equal(parseServerMessage({ type: "emotion", emotion: "feliz" }), null);
  assert.equal(parseServerMessage({ type: "action", tag: "spotify" }), null);
  assert.equal(parseServerMessage({ type: "state", state: "dormindo" }), null);
  assert.equal(parseServerMessage({ type: "outro" }), null);
});

test("microfone: eco e ruído cancelados, mono, 16 kHz", () => {
  const c = micConstraints();
  assert.equal(c.echoCancellation, true);
  assert.equal(c.noiseSuppression, true);
  assert.equal(c.channelCount, 1);
  assert.equal(c.sampleRate, 16000);
});
