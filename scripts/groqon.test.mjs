import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

function fakeGroq(handler) {
  return new Promise((resolve) => {
    const seen = [];
    const srv = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        seen.push(JSON.parse(body || "{}"));
        const { status = 200, json, headers = {} } = handler(seen.length);
        res.writeHead(status, { "content-type": "application/json", ...headers });
        res.end(JSON.stringify(json));
      });
    });
    srv.listen(0, () => resolve({ url: `http://127.0.0.1:${srv.address().port}`, seen, close: () => { srv.closeAllConnections(); srv.close(); } }));
  });
}

async function withGroq(handler, fn) {
  const g = await fakeGroq(handler);
  process.env.GROQ_BASE_URL = g.url;
  try { return await fn(g, await import("../lib/groq.ts")); } finally { g.close(); }
}

const completion = (message) => ({ id: "x", object: "chat.completion", created: 0, model: "m", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", ...message } }] });

test("usa o modelo pedido, limpa <think> e devolve as ferramentas", async () => {
  await withGroq(() => ({ json: completion({ content: "<think>hm</think> Oi", tool_calls: [{ id: "c1", type: "function", function: { name: "list_events", arguments: "{\"a\":1}" } }] }) }), async (g, { groqCompleteOn }) => {
    const r = await groqCompleteOn("k", "modelo-x", { messages: [{ role: "user", content: "oi" }] });
    assert.equal(g.seen[0].model, "modelo-x");
    assert.equal(r.content, "Oi");
    assert.deepEqual(r.toolCalls, [{ id: "c1", name: "list_events", arguments: "{\"a\":1}" }]);
    assert.equal(r.model, "modelo-x");
  });
});

test("resposta vazia não lança", async () => {
  await withGroq(() => ({ json: completion({ content: "" }) }), async (_g, { groqCompleteOn }) => {
    assert.deepEqual(await groqCompleteOn("k", "m", { messages: [] }), { content: "", toolCalls: [], model: "m" });
  });
});

test("429 é repassado com status e retry-after", async () => {
  await withGroq(() => ({ status: 429, headers: { "retry-after": "7" }, json: { error: { message: "rate limit" } } }), async (_g, { groqCompleteOn }) => {
    await assert.rejects(groqCompleteOn("k", "m", { messages: [] }), (e) => e.status === 429 && e.headers["retry-after"] === "7");
  });
});
