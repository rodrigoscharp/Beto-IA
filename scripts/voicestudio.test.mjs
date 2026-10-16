import test from "node:test";
import assert from "node:assert/strict";
import { voiceStudioConfig, speechBody, prependSilence, fetchSpeech, voiceStudioOnline, LEAD_SECS } from "../lib/voicestudio.ts";

/* WAV PCM de teste. `extraChunk`: um bloco LIST entre fmt e data, como alguns geradores gravam. */
function makeWav({ rate = 24000, samples = [1, 2, 3, 4], extraChunk = false } = {}) {
  const list = extraChunk ? 8 + 4 : 0;
  const buf = new ArrayBuffer(12 + 24 + list + 8 + samples.length * 2);
  const v = new DataView(buf);
  const str = (off, s) => [...s].forEach((c, i) => v.setUint8(off + i, c.charCodeAt(0)));
  str(0, "RIFF"); v.setUint32(4, buf.byteLength - 8, true); str(8, "WAVE");
  str(12, "fmt "); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  let off = 36;
  if (extraChunk) { str(off, "LIST"); v.setUint32(off + 4, 4, true); str(off + 8, "INFO"); off += 12; }
  str(off, "data"); v.setUint32(off + 4, samples.length * 2, true);
  samples.forEach((s, i) => v.setInt16(off + 8 + i * 2, s, true));
  return buf;
}

/** Acha o bloco data e devolve [início das amostras, tamanho]. */
function dataChunk(v) {
  for (let off = 12; off + 8 <= v.byteLength;) {
    const id = String.fromCharCode(v.getUint8(off), v.getUint8(off + 1), v.getUint8(off + 2), v.getUint8(off + 3));
    const size = v.getUint32(off + 4, true);
    if (id === "data") return [off + 8, size];
    off += 8 + size + (size % 2);
  }
  throw new Error("sem data");
}
const dataSize = (v) => dataChunk(v)[1];
function samples(v) {
  const [start, size] = dataChunk(v);
  return Array.from({ length: size / 2 }, (_, i) => v.getInt16(start + i * 2, true));
}

const okJson = (obj) => async () => new Response(JSON.stringify(obj), { status: 200, headers: { "Content-Type": "application/json" } });

test("config: padrões e env", () => {
  assert.deepEqual(voiceStudioConfig({}), { url: "http://localhost:3900", voice: "Beto", steps: 8, speed: 1 });
  assert.equal(voiceStudioConfig({ NEXT_PUBLIC_VOICESTUDIO_URL: "http://x:1/" }).url, "http://x:1");
  assert.equal(voiceStudioConfig({ NEXT_PUBLIC_VOICESTUDIO_STEPS: "abc" }).steps, 8);
  assert.equal(voiceStudioConfig({ NEXT_PUBLIC_VOICESTUDIO_STEPS: "16", NEXT_PUBLIC_VOICESTUDIO_SPEED: "1.1" }).steps, 16);
  assert.equal(voiceStudioConfig({ NEXT_PUBLIC_VOICESTUDIO_VOICE: "Outro" }).voice, "Outro");
});

test("corpo do pedido: voz, idioma e passos", () => {
  const b = speechBody("Oi chefe.", voiceStudioConfig({}));
  assert.deepEqual(b, { model: "omnivoice", input: "Oi chefe.", voice: "Beto", language: "pt", num_step: 8, speed: 1, response_format: "wav" });
});

test("texto longo corta no fim da última frase antes de 4096", () => {
  const s = "Frase curta. ".repeat(400);   // 5200 caracteres
  const input = speechBody(s, voiceStudioConfig({})).input;
  assert.ok(input.length <= 4096);
  assert.ok(input.endsWith("."));
});

test("silêncio na frente: amostras zeradas e tamanhos do cabeçalho certos", () => {
  const out = new DataView(prependSilence(makeWav({ samples: [1, 2, 3, 4], extraChunk: true }), 0.001));
  // 0,001 s a 24 kHz = 24 amostras de silêncio: data passa a ter (24 + 4) × 2 bytes
  assert.equal(dataSize(out), 56);
  assert.equal(out.getUint32(4, true), out.byteLength - 8);   // tamanho do RIFF
  assert.deepEqual(samples(out).slice(0, 24), Array(24).fill(0));
  assert.deepEqual(samples(out).slice(24), [1, 2, 3, 4]);
});

test("silêncio na frente: arquivo que não é WAV passa intacto", () => {
  const junk = new Uint8Array([1, 2, 3]).buffer;
  assert.equal(prependSilence(junk, 0.4), junk);
});

test("fetchSpeech: rede fora ou erro do servidor viram null", async () => {
  assert.equal(await fetchSpeech("oi", { fetchImpl: async () => { throw new TypeError("Failed to fetch"); } }), null);
  assert.equal(await fetchSpeech("oi", { fetchImpl: async () => new Response("x", { status: 409 }) }), null);
});

test("fetchSpeech: pede o endpoint certo e lead acrescenta 0,4 s ao áudio", async () => {
  const wav = makeWav({ samples: [5, 6] });
  let seen;
  const fetchImpl = async (url, init) => { seen = { url, init }; return new Response(wav.slice(0), { status: 200 }); };
  const plain = await fetchSpeech("oi", { fetchImpl });
  assert.equal(seen.url, "http://localhost:3900/v1/audio/speech");
  assert.equal(seen.init.method, "POST");
  assert.equal(JSON.parse(seen.init.body).voice, "Beto");
  assert.equal(plain.size, wav.byteLength);
  const led = await fetchSpeech("oi", { fetchImpl, lead: true });
  assert.equal(led.size, wav.byteLength + LEAD_SECS * 24000 * 2);
  assert.equal(led.type, "audio/wav");
});

test("voiceStudioOnline: só status ok conta", async () => {
  assert.equal(await voiceStudioOnline(okJson({ status: "ok" })), true);
  assert.equal(await voiceStudioOnline(okJson({ status: "starting" })), false);
  assert.equal(await voiceStudioOnline(async () => { throw new TypeError("Failed to fetch"); }), false);
  assert.equal(await voiceStudioOnline(async () => new Response("x", { status: 503 })), false);
});
