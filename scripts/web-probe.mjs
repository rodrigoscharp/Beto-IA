/* Sondagem da ferramenta embutida browser_search da Groq, com a chave real. Roda uma vez, fora da suíte de testes:
   GROQ_API_KEY=... node scripts/web-probe.mjs "cotação do dólar hoje" */
import Groq from "groq-sdk";

const key = process.env.GROQ_API_KEY;
if (!key) {
  console.error("Defina GROQ_API_KEY para rodar a sondagem.");
  process.exit(1);
}

const pergunta = process.argv[2] ?? "cotação do dólar hoje";
const groq = new Groq({ apiKey: key });
const busca = { type: "browser_search" };
const messages = [{ role: "user", content: pergunta }];
const noop = { type: "function", function: { name: "noop", description: "não faz nada", parameters: { type: "object", properties: {} } } };

const base = { model: "openai/gpt-oss-120b", messages, reasoning_effort: "low", tools: [busca], tool_choice: "required" };
const chamadas = [
  { rotulo: "1. gpt-oss-120b", params: base },
  { rotulo: "2. gpt-oss-20b", params: { ...base, model: "openai/gpt-oss-20b" } },
  { rotulo: "3. gpt-oss-120b com stream", params: { ...base, stream: true } },
  { rotulo: "4. gpt-oss-120b com function tool junto", params: { ...base, tools: [busca, noop], tool_choice: "auto" }, comTools: true },
];

const erroDe = (e) => `${e?.status ? `HTTP ${e.status}: ` : ""}${e?.message ?? e}`;

const rodarSemStream = async ({ rotulo, params, comTools }) => {
  const t0 = Date.now();
  try {
    const res = await groq.chat.completions.create(params);
    const ms = Date.now() - t0;
    const message = res.choices?.[0]?.message ?? {};
    const conteudo = (message.content ?? "(vazio)").slice(0, 600);
    console.log(`\n=== ${rotulo} ===\nstatus: ok\nlatência: ${ms} ms\nconteúdo: ${conteudo}\nchaves de message: ${JSON.stringify(Object.keys(message))}`);
    if (comTools) console.log(`message.tool_calls: ${JSON.stringify(message.tool_calls ?? null)}`);
  } catch (e) {
    console.log(`\n=== ${rotulo} ===\nstatus: erro: ${erroDe(e)}\nlatência: ${Date.now() - t0} ms`);
  }
};

const rodarComStream = async ({ rotulo, params }) => {
  const t0 = Date.now();
  try {
    const stream = await groq.chat.completions.create(params);
    let pedacos = 0;
    let texto = "";
    const chaves = new Set();
    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta ?? {};
      Object.keys(delta).forEach((k) => chaves.add(k));
      if (delta.content) {
        pedacos++;
        texto += delta.content;
      }
    }
    console.log(`\n=== ${rotulo} ===\nstatus: ok\nlatência: ${Date.now() - t0} ms\npedaços de texto: ${pedacos}\nconteúdo: ${texto.slice(0, 600) || "(vazio)"}\nchaves de delta: ${JSON.stringify([...chaves])}`);
  } catch (e) {
    console.log(`\n=== ${rotulo} ===\nstatus: erro: ${erroDe(e)}\nlatência: ${Date.now() - t0} ms`);
  }
};

for (const c of chamadas) {
  if (c.params.stream) await rodarComStream(c);
  else await rodarSemStream(c);
}
