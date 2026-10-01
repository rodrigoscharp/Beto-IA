import test from "node:test";
import assert from "node:assert/strict";
import { SpeechQueue } from "../lib/speechqueue.ts";

const tick = () => new Promise((r) => setImmediate(r));
async function flush(n = 8) { for (let i = 0; i < n; i++) await tick(); }

/* Dependências falsas: o teste controla quando cada áudio fica pronto e quando termina de tocar. */
function fakes({ failTexts = [] } = {}) {
  const log = [];
  const fetches = [];   // { text, first, resolve }
  const plays = [];     // { url, finish }
  const deps = {
    fetchAudio: (text, first) => new Promise((resolve) => {
      log.push(`fetch:${text}${first ? ":lead" : ""}`);
      fetches.push({ text, first, resolve: () => resolve(failTexts.includes(text) ? null : `url:${text}`) });
    }),
    play: (url, hooks) => {
      log.push(`play:${url}`);
      let finish; const done = new Promise((r) => { finish = r; });
      plays.push({ url, finish, hooks });
      return { done, stop: () => { log.push(`stop:${url}`); finish(); } };
    },
    showText: (t) => log.push(`show:${t}`),
    readingMs: () => 5,
    sleep: (ms) => { log.push(`sleep:${ms}`); return Promise.resolve(); },
    onFirstSound: () => log.push("firstSound"),
    revoke: (u) => log.push(`revoke:${u}`),
  };
  return { deps, log, fetches, plays };
}

test("toca as frases na ordem e mostra cada texto", async () => {
  const { deps, log, fetches, plays } = fakes();
  const q = new SpeechQueue(deps);
  q.push("um"); q.push("dois");
  const ended = q.end();
  await flush();
  fetches.forEach((f) => f.resolve());
  await flush();
  assert.equal(plays.length, 1);
  plays[0].hooks.onPlaying();
  plays[0].finish();
  await flush();
  assert.equal(plays.length, 2);
  plays[1].finish();
  await ended;
  assert.deepEqual(log.filter((l) => l.startsWith("play:") || l.startsWith("show:")), ["show:um", "play:url:um", "show:dois", "play:url:dois"]);
});

test("só a primeira frase pede o silêncio de abertura (lead)", async () => {
  const { deps, log, fetches } = fakes();
  const q = new SpeechQueue(deps);
  q.push("um"); q.push("dois");
  await flush();
  assert.deepEqual(log.filter((l) => l.startsWith("fetch:")), ["fetch:um:lead", "fetch:dois"]);
  q.cancel();
  fetches.forEach((f) => f.resolve());
});

test("no máximo 2 pedidos de voz ao mesmo tempo: a terceira frase espera", async () => {
  const { deps, log, fetches, plays } = fakes();
  const q = new SpeechQueue(deps);
  q.push("a"); q.push("b"); q.push("c"); q.push("d");
  await flush();
  assert.deepEqual(log.filter((l) => l.startsWith("fetch:")).length, 2);
  fetches[0].resolve();
  await flush();
  // a começou a tocar -> libera o pedido da próxima
  assert.equal(plays.length, 1);
  assert.equal(log.filter((l) => l.startsWith("fetch:")).length, 3);
  q.cancel();
  fetches.forEach((f) => f.resolve());
});

test("falha de voz numa frase: mostra o texto, espera o tempo de ler e segue", async () => {
  const { deps, log, fetches, plays } = fakes({ failTexts: ["ruim"] });
  const q = new SpeechQueue(deps);
  q.push("ruim"); q.push("boa");
  const ended = q.end();
  await flush();
  fetches.forEach((f) => f.resolve());
  await flush();
  assert.ok(log.includes("show:ruim") && log.includes("sleep:5"));
  assert.equal(plays.length, 1);
  assert.equal(plays[0].url, "url:boa");
  plays[0].finish();
  await ended;
});

test("onFirstSound dispara uma vez só: no primeiro áudio tocando ou na primeira legenda sem voz", async () => {
  const a = fakes();
  const q1 = new SpeechQueue(a.deps);
  q1.push("um"); q1.push("dois");
  const e1 = q1.end();
  await flush(); a.fetches.forEach((f) => f.resolve()); await flush();
  a.plays[0].hooks.onPlaying(); a.plays[0].hooks.onPlaying();
  a.plays[0].finish(); await flush(); a.plays[1].hooks.onPlaying(); a.plays[1].finish(); await e1;
  assert.equal(a.log.filter((l) => l === "firstSound").length, 1);

  const b = fakes({ failTexts: ["x", "y"] });
  const q2 = new SpeechQueue(b.deps);
  q2.push("x"); q2.push("y");
  const e2 = q2.end();
  await flush(); b.fetches.forEach((f) => f.resolve()); await e2;
  assert.equal(b.log.filter((l) => l === "firstSound").length, 1);
});

test("cancel para o áudio atual, não toca mais nada e libera end()", async () => {
  const { deps, log, fetches, plays } = fakes();
  const q = new SpeechQueue(deps);
  q.push("um"); q.push("dois");
  const ended = q.end();
  await flush(); fetches.forEach((f) => f.resolve()); await flush();
  assert.equal(plays.length, 1);
  q.cancel();
  await ended;
  await flush();
  assert.equal(plays.length, 1, "não pode começar a segunda");
  assert.ok(log.includes("stop:url:um"));
});

test("end() com a fila vazia resolve na hora", async () => {
  const { deps } = fakes();
  const q = new SpeechQueue(deps);
  await q.end();
});

test("frases que chegam depois do end() são ignoradas", async () => {
  const { deps, log } = fakes();
  const q = new SpeechQueue(deps);
  await q.end();
  q.push("tarde");
  await flush();
  assert.ok(!log.some((l) => l.startsWith("fetch:")));
});

test("o endereço do áudio é liberado depois de tocar", async () => {
  const { deps, log, fetches, plays } = fakes();
  const q = new SpeechQueue(deps);
  q.push("um");
  const ended = q.end();
  await flush(); fetches[0].resolve(); await flush();
  plays[0].finish();
  await ended;
  assert.ok(log.includes("revoke:url:um"));
});

test("pedido de voz que chega depois do cancel não toca", async () => {
  const { deps, plays, fetches } = fakes();
  const q = new SpeechQueue(deps);
  q.push("um");
  await flush();
  q.cancel();
  fetches[0].resolve();
  await flush();
  assert.equal(plays.length, 0);
});

test("isCancelled só vira true depois do cancel", async () => {
  const { deps } = fakes();
  const q = new SpeechQueue(deps);
  assert.equal(q.isCancelled(), false);
  q.cancel();
  assert.equal(q.isCancelled(), true);
});
