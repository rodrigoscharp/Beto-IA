import { NextRequest, NextResponse } from "next/server";
import { groqChat, groqChatStream, workingModel } from "@/lib/groq";
import { listMemories } from "@/lib/supabase";
import { getMyHubContext, myHubPromptBlock, type MyHubContext } from "@/lib/myhub";
import { getBrasiliaTime } from "@/lib/time";
import { needsTools } from "@/lib/intent";
import { buildSystemPrompt, detectNeedTools, type PromptMode } from "@/lib/prompt";

type Memories = { content: string; category: string }[];
type Msg = { role: string; content: string };

/** Uma linha por resposta nos logs da Vercel (filtrar por "[beto-metrics]"). Sem o texto da conversa. */
function logMetric(data: Record<string, unknown>) {
  console.log("[beto-metrics]", JSON.stringify({ evt: "chat", ...data }));
}

function promptFor(mode: PromptMode, memories: Memories, myhub: MyHubContext | null) {
  const t = getBrasiliaTime();
  return buildSystemPrompt(
    { memories, myhubBlock: myHubPromptBlock(myhub, t.date), date: t.date, dateLabel: t.dateLabel, time: t.time, period: t.period },
    mode,
  );
}

// Cache memórias por 5 min para não bater no Supabase a cada mensagem
let _memCache: { data: { content: string; category: string }[]; ts: number } | null = null;
async function getCachedMemories() {
  if (_memCache && Date.now() - _memCache.ts < 5 * 60 * 1000) return _memCache.data;
  // Não deixa o Supabase atrasar a resposta: passou de 600ms, segue sem memórias nesta vez.
  const fetching = listMemories(25).then((data) => { _memCache = { data, ts: Date.now() }; return data; });
  fetching.catch(() => {});
  const slow = new Promise<null>((r) => setTimeout(() => r(null), 600));
  try {
    return (await Promise.race([fetching, slow])) ?? _memCache?.data ?? [];
  } catch {
    return _memCache?.data ?? [];
  }
}

/* Abre a resposta em streaming e devolve o primeiro pedaço de texto. No modo conversa espera o suficiente para saber
   se o modelo respondeu [NEEDTOOLS] (pedido de ação): nesse caso refaz com o prompt completo. Erros acontecem AQUI,
   antes de qualquer byte ir para o cliente, para a rota poder responder com um erro normal e o app cair no caminho antigo. */
async function openReply(apiKey: string, messages: Msg[], mode: PromptMode, memories: Memories, myhub: MyHubContext | null) {
  const build = (m: PromptMode, mh: MyHubContext | null) => ({
    messages: [{ role: "system", content: promptFor(m, memories, mh) }, ...messages],
    temperature: 0.7,
    max_tokens: 700,
  });
  let gen = groqChatStream(apiKey, build(mode, myhub) as never);
  let finalMode = mode;
  let retried = false;
  let head = "";

  if (mode === "chat") {
    let buf = "";
    for (;;) {
      const r = await gen.next();
      if (r.done) break;
      buf += r.value;
      if (detectNeedTools(buf) !== "maybe") break;   // aceita [emo:X] antes, outra caixa e [NEED_TOOLS]
    }
    if (detectNeedTools(buf) === "yes") {
      await gen.return();
      retried = true;
      finalMode = "full";
      gen = groqChatStream(apiKey, build("full", await getMyHubContext()) as never);
    } else {
      head = buf;
    }
  }
  if (!head) {
    const r = await gen.next();
    if (r.done) throw new Error("O modelo não devolveu texto.");
    head = r.value;
  }
  return { gen, head, mode: finalMode, retried };
}

export async function POST(req: NextRequest) {
  try {
    const { messages, stream, full: forceFull } = await req.json();

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json({ error: "Payload inválido: messages é obrigatório." }, { status: 400 });
    }

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "GROQ_API_KEY não configurada no servidor." }, { status: 500 });
    }

    const t0 = Date.now();
    // `full`: o cliente já viu o modo conversa falhar (disse que fez sem ter ferramenta) e pede o prompt completo.
    const mode: PromptMode = forceFull === true || needsTools(messages) ? "full" : "chat";
    // Conversa simples não precisa do My Hub: pula a ida ao servidor dele.
    const [memories, myhub] = await Promise.all([getCachedMemories(), mode === "full" ? getMyHubContext() : Promise.resolve(null)]);
    const ctxMs = Date.now() - t0;

    if (stream === true) {
      const { gen, head, mode: usedMode, retried } = await openReply(apiKey, messages, mode, memories, myhub);
      const ttftMs = Date.now() - t0;
      const encoder = new TextEncoder();
      let chars = head.length;
      let cancelled = false;
      const body = new ReadableStream<Uint8Array>({
        async start(controller) {
          const close = () => { try { controller.close(); } catch { /* já fechado ou cancelado */ } };
          try {
            controller.enqueue(encoder.encode(head));
            for await (const piece of gen) {
              if (cancelled) break;   // o cliente desistiu (tocou no orbe, novo turno): para de gastar tokens
              chars += piece.length;
              controller.enqueue(encoder.encode(piece));
            }
            close();
          } catch (e) {
            if (!cancelled) console.error("[Beto API] stream interrompido:", e);
            close();   // o cliente fala o que já recebeu
          } finally {
            await gen.return().catch(() => {});
            logMetric({ mode: usedMode, stream: true, model: workingModel(), ctx_ms: ctxMs, ttft_ms: ttftMs, total_ms: Date.now() - t0, chars, retried, cancelled });
          }
        },
        cancel() { cancelled = true; },
      });
      return new NextResponse(body, {
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "x-beto-mode": usedMode },
      });
    }

    const run = (m: PromptMode, mh: MyHubContext | null) => groqChat(apiKey, {
      messages: [{ role: "system", content: promptFor(m, memories, mh) }, ...messages],
      temperature: 0.7,
      max_tokens: 700,
    });
    let reply = await run(mode, myhub);
    let usedMode = mode;
    let retried = false;
    if (mode === "chat" && detectNeedTools(reply) === "yes") {
      retried = true;
      usedMode = "full";
      reply = await run("full", await getMyHubContext());
    }
    logMetric({ mode: usedMode, stream: false, model: workingModel(), ctx_ms: ctxMs, total_ms: Date.now() - t0, chars: reply.length, retried });
    return NextResponse.json({ reply }, { headers: { "x-beto-model": workingModel() ?? "" } });
  } catch (error: unknown) {
    console.error("[Beto API] Erro:", error);
    const message = error instanceof Error ? error.message : "Erro desconhecido.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
