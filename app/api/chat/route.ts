import { NextRequest, NextResponse } from "next/server";
import { groqChat, groqChatStream, groqComplete, workingModel } from "@/lib/groq";
import { listMemories } from "@/lib/supabase";
import { getMyHubContext, myHubPromptBlock, type MyHubContext } from "@/lib/myhub";
import { getBrasiliaTime } from "@/lib/time";
import { needsTools, userConfirmed, wantsCalendar, wantsCalendarWrite } from "@/lib/intent";
import { runToolLoop, type LoopMsg } from "@/lib/toolloop";
import { CALENDAR_TOOLS, executeCalendarTool, type ToolCtx } from "@/lib/tools/calendar";
import { GoogleApiError, googleCalendarApi } from "@/lib/tools/googlecalendar";
import { getGoogleToken } from "@/lib/google";
import { buildSystemPrompt, detectNeedTools, type PromptMode } from "@/lib/prompt";

type Memories = { content: string; category: string }[];
type Msg = { role: string; content: string };

/** Uma linha por resposta nos logs da Vercel (filtrar por "[beto-metrics]"). Sem o texto da conversa. */
function logMetric(data: Record<string, unknown>) {
  console.log("[beto-metrics]", JSON.stringify({ evt: "chat", ...data }));
}

function promptFor(mode: PromptMode, memories: Memories, myhub: MyHubContext | null, calendar = false) {
  const t = getBrasiliaTime();
  return buildSystemPrompt(
    { memories, myhubBlock: myHubPromptBlock(myhub, t.date), date: t.date, dateLabel: t.dateLabel, time: t.time, period: t.period, calendar },
    mode,
  );
}

/* Turno com as ferramentas de agenda: o modelo pode pedir ferramentas (ver, criar, remarcar, cancelar, achar horário),
   o servidor executa no Google Calendar e devolve o resultado, até o modelo responder em texto. Cancelar e remarcar com
   convidados só executam se o chefe acabou de confirmar (userConfirmed): quem decide é o servidor, não o modelo. */
async function replyWithCalendar(req: NextRequest, apiKey: string, messages: Msg[], memories: Memories) {
  const [myhub, token] = await Promise.all([getMyHubContext(), getGoogleToken(req)]);
  const t = getBrasiliaTime();
  const userText = messages.filter((m) => m.role === "user").map((m) => m.content).join("\n");
  let lastUser = -1;
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === "user") { lastUser = i; break; }
  const before = lastUser > 0 ? messages[lastUser - 1] : undefined;
  const ctx: ToolCtx = {
    api: token ? googleCalendarApi(token) : null,
    nowLocal: `${t.date}T${t.time}`,
    confirmed: userConfirmed(messages),
    userText,                                                   // só o que o CHEFE falou (nunca texto de evento)
    lastAssistant: before?.role === "assistant" ? before.content : "",
    writeIntent: wantsCalendarWrite(messages),
    state: { destructive: 0 },
  };
  let needsLogin = false;
  const result = await runToolLoop({
    messages: [{ role: "system", content: promptFor("full", memories, myhub, true) }, ...messages] as LoopMsg[],
    complete: async (msgs) => {
      const c = await groqComplete(apiKey, { messages: msgs, tools: CALENDAR_TOOLS, tool_choice: "auto", temperature: 0.3, max_tokens: 700 } as never);
      return { content: c.content, toolCalls: c.toolCalls };
    },
    finalize: async (msgs) => {
      const c = await groqComplete(apiKey, {
        messages: [...msgs, { role: "system", content: "Pare de usar ferramentas. Em uma frase curta e falada, diga ao chefe o que já foi feito na agenda e o que ficou faltando." }] as never,
        temperature: 0.3, max_tokens: 300,
      } as never);
      return c.content;
    },
    execute: async (name, args) => {
      try {
        const r = await executeCalendarTool(name, args, ctx);
        if ((r as { needsLogin?: boolean })?.needsLogin) needsLogin = true;
        return r;
      } catch (e) {
        if (e instanceof GoogleApiError && e.status === 401) { needsLogin = true; return { needsLogin: true, error: "A sessão do Google expirou." }; }
        throw e;
      }
    },
  });
  const acted = result.calls.some((c) => c.ok && /^(create|update|delete)_event$/.test(c.name));
  let text = result.text || (result.hitLimit
    ? (acted ? "Fiz parte do pedido na agenda, mas não consegui terminar. Confere lá, chefe." : "Não consegui concluir isso na agenda agora, chefe.")
    : "");
  if (detectNeedTools(text) === "yes") text = "Não consegui fazer isso agora, chefe.";   // o marcador interno nunca chega ao chefe
  return { text, needsLogin, steps: result.steps, acted, tools: result.calls.map((c) => (c.ok ? c.name : `${c.name}:erro`)) };
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
    let reply: string;
    let usedMode = mode;
    let retried = false;
    let needsGoogleLogin = false;
    let tools: string[] = [];
    let acted = false;      // alguma ferramenta de ESCRITA (criar/remarcar/cancelar) executou com sucesso
    let steps = 1;
    const viaCalendar = async () => {
      const r = await replyWithCalendar(req, apiKey, messages, memories);
      needsGoogleLogin = r.needsLogin;
      tools = r.tools;
      acted = r.acted;
      steps = r.steps;
      return r.text;
    };
    // Pedido de agenda: o prompt completo vai junto com as ferramentas do Calendar. (`full` do cliente só força o prompt
    // completo; não liga as ferramentas da agenda por si: o registro do My Hub, por exemplo, não precisa delas.)
    if (mode === "full" && wantsCalendar(messages)) {
      reply = await viaCalendar();
    } else {
      reply = await run(mode, myhub);
      // O modelo sem as ferramentas pediu [NEEDTOOLS] (conversa -> completo, ou completo sem agenda -> com agenda).
      if (detectNeedTools(reply) === "yes") {
        retried = true;
        usedMode = "full";
        reply = await viaCalendar();
      }
    }
    logMetric({ mode: usedMode, stream: false, model: workingModel(), ctx_ms: ctxMs, total_ms: Date.now() - t0, chars: reply.length, retried, steps, tools });
    return NextResponse.json({
      reply,
      ...(needsGoogleLogin ? { needsGoogleLogin: true } : {}),
      ...(acted ? { usedTools: true } : {}),              // a agenda JÁ foi alterada: o cliente não duvida da resposta nem refaz o registro do My Hub
    }, { headers: { "x-beto-model": workingModel() ?? "" } });
  } catch (error: unknown) {
    console.error("[Beto API] Erro:", error);
    const message = error instanceof Error ? error.message : "Erro desconhecido.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
