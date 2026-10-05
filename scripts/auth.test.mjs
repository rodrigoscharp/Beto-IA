import test from "node:test";
import assert from "node:assert/strict";
import { voiceTokenOk } from "../lib/auth.ts";

const TOKEN = "a".repeat(32);

test("token certo em /api/chat passa", () => {
  assert.equal(voiceTokenOk(`Bearer ${TOKEN}`, "/api/chat", TOKEN), true);
  assert.equal(voiceTokenOk(`bearer ${TOKEN}`, "/api/chat", TOKEN), true);
});

test("sem env, token curto, caminho errado ou valor errado: não passa", () => {
  assert.equal(voiceTokenOk(`Bearer ${TOKEN}`, "/api/chat", undefined), false);
  assert.equal(voiceTokenOk("Bearer curto", "/api/chat", "curto"), false);
  assert.equal(voiceTokenOk(`Bearer ${TOKEN}`, "/api/tts", TOKEN), false);
  assert.equal(voiceTokenOk(`Bearer ${TOKEN}x`, "/api/chat", TOKEN), false);
  assert.equal(voiceTokenOk(`Bearer ${TOKEN.slice(1)}`, "/api/chat", TOKEN), false);
  assert.equal(voiceTokenOk(null, "/api/chat", TOKEN), false);
  assert.equal(voiceTokenOk(TOKEN, "/api/chat", TOKEN), false);   // sem "Bearer"
});
