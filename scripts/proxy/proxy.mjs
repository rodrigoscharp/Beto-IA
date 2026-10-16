/* Proxy local do Beto: serve o app da Vercel em https://localhost:3443.

   Por quê: o Safari bloqueia (política do WebKit) qualquer pedido de um site público para o localhost, mesmo em HTTPS
   com certificado válido, e a voz vem do VoiceStudio em https://localhost:3900. Com a página vindo do localhost, a
   chamada à voz passa a ser localhost para localhost e o Safari deixa.

   Repassa tudo para a Vercel sem buffer (o stream de /api/chat chega na hora) e sem dependências, para gastar pouca
   memória. Sem WebSocket: o serviço voice/ (localhost:7860) é chamado direto pela página.

   Uso (o LaunchAgent já chama assim):
     BETO_PROXY_CERT=cert.pem BETO_PROXY_KEY=key.pem node proxy.mjs
   Opcionais: BETO_UPSTREAM (padrão https://betoia.vercel.app), BETO_PROXY_PORT (padrão 3443). */

import http from "node:http";
import https from "node:https";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Cabeçalhos de uma conexão só, que não atravessam o proxy. x-forwarded-for fica de fora para a Vercel pôr o IP real.
const HOP = new Set([
  "connection", "keep-alive", "proxy-connection", "proxy-authenticate", "proxy-authorization",
  "te", "trailer", "transfer-encoding", "upgrade", "x-forwarded-for",
]);

const swapPrefix = (value, from, to) => (value === from || value.startsWith(from + "/") || value.startsWith(from + "?") ? to + value.slice(from.length) : value);

/** Cabeçalhos do navegador para a Vercel: ela tem de ver o próprio endereço, não o localhost. */
export function requestHeaders(headers, { local, upstream }) {
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    if (v === undefined || HOP.has(k)) continue;
    out[k] = v;
  }
  out.host = new URL(upstream).host;
  if (typeof out.origin === "string") out.origin = swapPrefix(out.origin, local, upstream);
  if (typeof out.referer === "string") out.referer = swapPrefix(out.referer, local, upstream);
  return out;
}

/** Cabeçalhos da Vercel para o navegador. Sem HSTS: ele vale para o host inteiro, todas as portas, e faria o Safari
    forçar HTTPS em http://localhost:3000 (dev) e http://localhost:7860 (serviço de voz). */
export function responseHeaders(headers, { local, upstream }) {
  const out = {};
  const upHost = new URL(upstream).hostname;
  for (const [k, v] of Object.entries(headers)) {
    if (v === undefined || HOP.has(k) || k === "strict-transport-security") continue;
    out[k] = v;
  }
  if (typeof out.location === "string") out.location = swapPrefix(out.location, upstream, local);
  if (out["set-cookie"]) {
    const domain = new RegExp(`;\\s*domain=\\.?${upHost.replace(/\./g, "\\.")}(?=;|$)`, "i");
    out["set-cookie"] = [].concat(out["set-cookie"]).map((c) => c.replace(domain, ""));
  }
  return out;
}

/** Handler de pedidos: repassa para o upstream e devolve a resposta em stream. */
export function createHandler({ local, upstream }) {
  const up = new URL(upstream);
  const mod = up.protocol === "https:" ? https : http;
  // Conexões abertas com a Vercel: sem pagar TCP + TLS a cada pedido.
  const agent = new mod.Agent({ keepAlive: true, maxSockets: 32, maxFreeSockets: 4, timeout: 60_000 });

  return (req, res) => {
    req.socket.setNoDelay(true);
    const out = mod.request({
      protocol: up.protocol,
      hostname: up.hostname,
      port: up.port || undefined,
      method: req.method,
      path: req.url,
      headers: requestHeaders(req.headers, { local, upstream }),
      agent,
    }, (upRes) => {
      res.writeHead(upRes.statusCode ?? 502, upRes.statusMessage, responseHeaders(upRes.headers, { local, upstream }));
      res.flushHeaders();
      upRes.pipe(res);
      upRes.on("error", () => res.destroy());
    });

    out.on("error", (e) => {
      if (res.headersSent) { res.destroy(); return; }
      console.error(`[proxy] ${req.method} ${req.url}: ${e.message}`);
      res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
      res.end("Beto fora do ar: a Vercel não respondeu.");
    });
    // Navegador desistiu (turno interrompido, aba fechada): cancela o pedido à Vercel.
    res.on("close", () => { if (!res.writableFinished) out.destroy(); });
    req.pipe(out);
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.BETO_PROXY_PORT || 3443);
  const upstream = (process.env.BETO_UPSTREAM || "https://betoia.vercel.app").replace(/\/+$/, "");
  const local = `https://localhost:${port}`;
  const server = https.createServer(
    { cert: readFileSync(process.env.BETO_PROXY_CERT), key: readFileSync(process.env.BETO_PROXY_KEY) },
    createHandler({ local, upstream }),
  );
  server.listen(port, "127.0.0.1", () => console.log(`[proxy] ${local} -> ${upstream}`));
}
