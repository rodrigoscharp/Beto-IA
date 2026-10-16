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
/* System longo e genérico, do tamanho do prompt de produção em ordem de grandeza (não é o prompt do app): a sondagem tem de
   medir a busca nas mesmas condições da rota (system grande, max_tokens 900, temperatura 0.3). */
const SYSTEM = [
  "Você é um assistente de voz em português do Brasil. Fala de um jeito natural, direto e simpático, como um colega de trabalho que sabe muito e respeita o tempo de quem pergunta.",
  "Suas respostas viram áudio: nada de listas, tabelas, markdown, emojis ou endereços de site. Escreva frases curtas, com pontuação clara, que soem bem quando lidas em voz alta.",
  "Ajuste o tamanho ao pedido. Pergunta de fato ou de sim e não: uma ou duas frases. Explicação: um parágrafo curto. Decisão importante: o essencial primeiro e, se fizer sentido, ofereça detalhar.",
  "Quando usar informação da internet, diga de onde ela veio pelo nome do site ou do veículo e de quando ela é, principalmente para cotações, placares, previsões do tempo e notícias.",
  "Se não encontrar nada confiável, diga isso em uma frase e não invente números, datas, nomes ou citações. É melhor admitir que não sabe do que arriscar um dado errado.",
  "Não repita a pergunta de volta, não comece com saudações longas e não termine sempre com a mesma frase. Varie o jeito de começar e de fechar.",
  "Trate o usuário pelo nome só de vez em quando. Use números por extenso quando forem curtos e em algarismos quando forem longos, sempre de forma que fique fácil de ouvir.",
  "Se o pedido for ambíguo, escolha a interpretação mais provável e responda; só pergunte de volta quando a resposta mudar muito dependendo do que ele quis dizer.",
  "Mantenha o tom calmo e confiante. Nada de exageros, nada de jargão sem necessidade e nada de explicar como você funciona por dentro.",
].join(" ");
const messages = [{ role: "system", content: SYSTEM }, { role: "user", content: pergunta }];
const noop = { type: "function", function: { name: "noop", description: "não faz nada", parameters: { type: "object", properties: {} } } };

// Mesmos parâmetros da rota (lib/web.ts): max_tokens 900 e temperatura 0.3.
const base = { model: "openai/gpt-oss-120b", messages, reasoning_effort: "low", tools: [busca], tool_choice: "required", max_tokens: 900, temperature: 0.3 };
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
    const choice = res.choices?.[0] ?? {};
    const message = choice.message ?? {};
    const conteudo = (message.content || "(vazio)").slice(0, 600);
    console.log(`\n=== ${rotulo} ===\nstatus: ok\nlatência: ${ms} ms\nfinish_reason: ${choice.finish_reason ?? null}\nusage: ${JSON.stringify(res.usage ?? null)}\nconteúdo: ${conteudo}\nchaves de message: ${JSON.stringify(Object.keys(message))}`);
    console.log(`message.executed_tools: ${JSON.stringify(message.executed_tools ?? null).slice(0, 600)}`);
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
    let primeiro = null;        // ms até o primeiro pedaço do stream (qualquer um)
    let primeiroTexto = null;   // ms até o primeiro pedaço com texto
    const chaves = new Set();
    for await (const chunk of stream) {
      if (primeiro === null) primeiro = Date.now() - t0;
      const delta = chunk.choices?.[0]?.delta ?? {};
      Object.keys(delta).forEach((k) => chaves.add(k));
      if (delta.content) {
        if (primeiroTexto === null) primeiroTexto = Date.now() - t0;
        pedacos++;
        texto += delta.content;
      }
    }
    console.log(`\n=== ${rotulo} ===\nstatus: ok\nlatência: ${Date.now() - t0} ms\nprimeiro pedaço: ${primeiro ?? "-"} ms\nprimeiro pedaço com texto: ${primeiroTexto ?? "-"} ms\npedaços de texto: ${pedacos}\nconteúdo: ${texto.slice(0, 600) || "(vazio)"}\nchaves de delta: ${JSON.stringify([...chaves])}`);
  } catch (e) {
    console.log(`\n=== ${rotulo} ===\nstatus: erro: ${erroDe(e)}\nlatência: ${Date.now() - t0} ms`);
  }
};

for (const c of chamadas) {
  if (c.params.stream) await rodarComStream(c);
  else await rodarSemStream(c);
}
