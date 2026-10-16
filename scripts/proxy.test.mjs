import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { requestHeaders, responseHeaders, createHandler } from "./proxy/proxy.mjs";

const O = { local: "https://localhost:3443", upstream: "https://betoia.vercel.app" };

test("pedido: host, origin e referer da Vercel, sem cabeçalhos de salto nem x-forwarded-for", () => {
  const h = requestHeaders({
    host: "localhost:3443",
    origin: "https://localhost:3443",
    referer: "https://localhost:3443/x?y=1",
    connection: "keep-alive",
    "keep-alive": "timeout=5",
    "transfer-encoding": "chunked",
    upgrade: "h2c",
    "x-forwarded-for": "1.2.3.4",
    cookie: "beto_auth=abc",
    "content-type": "application/json",
  }, O);
  assert.equal(h.host, "betoia.vercel.app");
  assert.equal(h.origin, "https://betoia.vercel.app");
  assert.equal(h.referer, "https://betoia.vercel.app/x?y=1");
  for (const k of ["connection", "keep-alive", "transfer-encoding", "upgrade", "x-forwarded-for"]) assert.equal(h[k], undefined, k);
  assert.equal(h.cookie, "beto_auth=abc");
  assert.equal(h["content-type"], "application/json");
});

test("pedido: origin de outro site passa como veio", () => {
  assert.equal(requestHeaders({ origin: "https://evil.example" }, O).origin, "https://evil.example");
});

test("resposta: Location da Vercel vira o endereço local; relativo e de terceiros ficam iguais", () => {
  assert.equal(responseHeaders({ location: "https://betoia.vercel.app/?calendar=ok" }, O).location, "https://localhost:3443/?calendar=ok");
  assert.equal(responseHeaders({ location: "/login" }, O).location, "/login");
  const g = "https://accounts.google.com/o/oauth2/v2/auth?redirect_uri=https%3A%2F%2Fbetoia.vercel.app%2Fapi%2Fcalendar%2Fcallback";
  assert.equal(responseHeaders({ location: g }, O).location, g);
});

test("resposta: sem HSTS (valeria para todas as portas do localhost) e sem cabeçalhos de salto", () => {
  const h = responseHeaders({
    "strict-transport-security": "max-age=63072000; includeSubDomains; preload",
    connection: "close",
    "transfer-encoding": "chunked",
    "content-encoding": "br",
  }, O);
  assert.equal(h["strict-transport-security"], undefined);
  assert.equal(h.connection, undefined);
  assert.equal(h["transfer-encoding"], undefined);
  assert.equal(h["content-encoding"], "br");
});

test("resposta: todos os Set-Cookie chegam, sem o Domain da Vercel", () => {
  const h = responseHeaders({
    "set-cookie": [
      "beto_auth=1.abc; Path=/; HttpOnly; Secure; SameSite=lax",
      "sp_at=tok; Path=/; Domain=betoia.vercel.app; HttpOnly",
    ],
  }, O);
  assert.deepEqual(h["set-cookie"], [
    "beto_auth=1.abc; Path=/; HttpOnly; Secure; SameSite=lax",
    "sp_at=tok; Path=/; HttpOnly",
  ]);
});

/* Ponta a ponta: upstream http falso e proxy http com o mesmo handler do serviço (o TLS fica de fora). */
async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return `http://127.0.0.1:${server.address().port}`;
}

async function withProxy(upstreamHandler, fn) {
  const upstream = http.createServer(upstreamHandler);
  const upUrl = await listen(upstream);
  const proxy = http.createServer(createHandler({ local: O.local, upstream: upUrl }));
  const pxUrl = await listen(proxy);
  try { await fn(pxUrl, upUrl, upstream); }
  finally {
    upstream.closeAllConnections?.(); proxy.closeAllConnections?.();
    upstream.close(); proxy.close();
  }
}

test("POST chega inteiro ao upstream, com o Host dele", async () => {
  let got;
  await withProxy((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => { got = { body, host: req.headers.host, method: req.method, url: req.url }; res.end("ok"); });
  }, async (px, up) => {
    const big = JSON.stringify({ password: "x".repeat(100_000) });
    const r = await fetch(`${px}/api/auth/login?a=1`, { method: "POST", body: big, headers: { "content-type": "application/json" } });
    assert.equal(r.status, 200);
    assert.equal(await r.text(), "ok");
    assert.equal(got.body, big);
    assert.equal(got.method, "POST");
    assert.equal(got.url, "/api/auth/login?a=1");
    assert.equal(got.host, new URL(up).host);
  });
});

test("stream: o primeiro bloco chega antes de o upstream mandar o segundo", async () => {
  let sendSecond;
  const second = new Promise((r) => (sendSecond = r));
  await withProxy(async (_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.write("primeiro|");
    await second;
    res.end("segundo");
  }, async (px) => {
    const r = await fetch(`${px}/api/chat`);
    const reader = r.body.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    assert.equal(first, "primeiro|");
    sendSecond();
    let rest = "";
    for (;;) { const { done, value } = await reader.read(); if (done) break; rest += new TextDecoder().decode(value); }
    assert.equal(rest, "segundo");
  });
});

test("upstream fora do ar: 502", async () => {
  const dead = http.createServer();
  const deadUrl = await listen(dead);
  dead.close();
  await once(dead, "close");
  const proxy = http.createServer(createHandler({ local: O.local, upstream: deadUrl }));
  const px = await listen(proxy);
  try {
    const r = await fetch(`${px}/`);
    assert.equal(r.status, 502);
  } finally { proxy.close(); }
});

test("cliente que desiste no meio cancela o pedido ao upstream e o proxy segue de pé", async () => {
  let upstreamClosed;
  const closed = new Promise((r) => (upstreamClosed = r));
  await withProxy((req, res) => {
    if (req.url === "/lento") {
      res.writeHead(200);
      res.write("a");
      res.on("close", () => upstreamClosed());
      return;   // nunca termina
    }
    res.end("vivo");
  }, async (px) => {
    const ac = new AbortController();
    const r = await fetch(`${px}/lento`, { signal: ac.signal });
    await r.body.getReader().read();
    ac.abort();
    await closed;
    const ok = await fetch(`${px}/`);
    assert.equal(await ok.text(), "vivo");
  });
});
