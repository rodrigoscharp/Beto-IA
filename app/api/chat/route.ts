import { NextRequest, NextResponse } from "next/server";
import { groqChat, groqChatStream, groqComplete, workingModel } from "@/lib/groq";
import { deleteMemory, listMemoriesStrict, saveMemory } from "@/lib/supabase";
import { getMyHubContext, myHubDesfazer, myHubRegistrar, myHubWriteConfigured, type MyHubContext } from "@/lib/myhub";
import { myHubPromptBlock } from "@/lib/myhubprompt";
import { getBrasiliaTime } from "@/lib/time";
import { claimsWrite, userConfirmed, wantsCalendarWrite, memoryGroundText, wantsMemoryForget, wantsMemorySave, wantsMemoryTopic, wantsMyHubUndo, wantsMyHubWrite } from "@/lib/intent";
import { runToolLoop, type LoopMsg } from "@/lib/toolloop";
import { CALENDAR_TOOLS, executeCalendarTool, type ToolCtx } from "@/lib/tools/calendar";
import { GoogleApiError, googleCalendarApi } from "@/lib/tools/googlecalendar";
import { MYHUB_TOOLS, executeMyHubTool, type MyHubCtx } from "@/lib/tools/myhub";
import { MEMORY_TOOLS, executeMemoryTool, type MemoryCtx } from "@/lib/tools/memory";
import { getGoogleToken } from "@/lib/google";
import { buildSystemPrompt, detectNeedTools, type PromptMode } from "@/lib/prompt";
import { planTurn, type ToolSets } from "@/lib/turnplan";
import { encodeLine, type WireLine, type WireMeta } from "@/lib/voicewire";

type Memories = { content: string; category: string }[];
type Msg = { role: string; content: string };

/** Uma linha por resposta nos logs da Vercel (filtrar por "[beto-metrics]"). Sem o texto da conversa. */
function logMetric(data: Record<string, unknown>) {
  console.log("[beto-metrics]", JSON.stringify({ evt: "chat", ...data }));
}

function promptFor(mode: PromptMode, memories: Memories, myhub: MyHubContext | null, tools: { calendar?: boolean; myhub?: boolean; memory?: boolean } = {}) {
  const t = getBrasiliaTime();
  return buildSystemPrompt(
    {
      memories,
      myhubBlock: myHubPromptBlock(myhub, t.date, { writeConfigured: myHubWriteConfigured(), tools: !!tools.myhub }),
      date: t.date, dateLabel: t.dateLabel, time: t.time, period: t.period, calendar: !!tools.calendar, memory: !!tools.memory,
    },
    mode,
  );
}

/** O navegador guarda o último caminho de desfazer do My Hub e o reenvia aqui; valida o formato e limita o tamanho. */
function parseUndo(raw: unknown): { path: string | null; resumo: string; ts: number } | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const pathOk = o.path === null || (typeof o.path === "string" && /^[\x21-\x7e]{1,300}$/.test(o.path));   // sem espaços nem controle
  if (!pathOk || typeof o.resumo !== "string" || o.resumo.length > 300 || typeof o.ts !== "number" || !Number.isFinite(o.ts)) return null;
  return { path: o.path as string | null, resumo: o.resumo, ts: o.ts };
}
interface UndoState { path: string | null; resumo: string; ts: number }

/** Estados de resultado que significam "a ferramenta de escrita realmente fez o que o chefe pediu". */
const WRITE_DONE = new Set(["created", "updated", "deleted", "registered", "undone", "saved", "forgotten"]);

const CORRECTION = "[SISTEMA] Você disse que já fez, mas nenhuma ferramenta de escrita foi executada com sucesso, então NADA foi feito. Chame agora a ferramenta certa, ou diga o que falta. Não diga que fez sem a ferramenta.";

/* Turno com ferramentas: o modelo pode pedir ferramentas (agenda e/ou My Hub), o servidor executa e devolve o resultado,
   até o modelo responder em texto. Quem decide o que é permitido é o servidor, não o modelo: cancelar, remarcar com
   convidados, marcar por cima de conflito e registrar valor alto só executam com o "sim" do chefe a uma pergunta que cita
   o evento ou o valor (userConfirmed + lib/tools). A rede de proteção "disse que fez sem fazer" também mora aqui. */
async function replyWithTools(req: NextRequest, apiKey: string, messages: Msg[], memories: Memories, sets: ToolSets, undoIn: UndoState | null) {
  const [myhub, token] = await Promise.all([getMyHubContext(), sets.calendar ? getGoogleToken(req) : Promise.resolve(null)]);
  const t = getBrasiliaTime();
  const userText = messages.filter((m) => m.role === "user").map((m) => m.content).join("\n");
  let lastUser = -1;
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === "user") { lastUser = i; break; }
  const before = lastUser > 0 ? messages[lastUser - 1] : undefined;
  const lastAssistant = before?.role === "assistant" ? before.content : "";
  const confirmed = userConfirmed(messages);
  const calWrite = wantsCalendarWrite(messages);
  const hubWrite = wantsMyHubWrite(messages);

  const calCtx: ToolCtx = {
    api: token ? googleCalendarApi(token) : null,
    nowLocal: `${t.date}T${t.time}`,
    confirmed, userText, lastAssistant,                         // userText: só o que o CHEFE falou (nunca texto de evento)
    writeIntent: calWrite,
    state: { destructive: 0 },
  };
  const hubCtx: MyHubCtx = {
    api: myHubWriteConfigured() ? { register: myHubRegistrar, undo: myHubDesfazer } : null,
    writeIntent: hubWrite, undoIntent: wantsMyHubUndo(messages),
    confirmed, lastAssistant, undo: undoIn, nowMs: Date.now(),
    state: { writes: 0, seen: [] },
  };

  const memCtx: MemoryCtx = {
    api: memoryConfigured()
      ? { list: async (n) => (await listMemoriesStrict(n)).flatMap((m) => (m.id ? [{ id: m.id, content: m.content, category: m.category, created_at: m.created_at }] : [])), save: saveMemory, remove: deleteMemory }
      : null,
    saveIntent: wantsMemorySave(messages), forgetIntent: wantsMemoryForget(messages),
    userText: memoryGroundText(messages),   // só o que o CHEFE disse: o conteúdo salvo e a busca de esquecer têm de vir daqui
    state: { saves: 0, forgets: 0 },
  };

  let needsLogin = false;
  let acted = false;
  const tools = [...(sets.calendar ? CALENDAR_TOOLS : []), ...(sets.myhub ? MYHUB_TOOLS : []), ...(sets.memory ? MEMORY_TOOLS : [])];
  const system = promptFor("full", memories, myhub, sets);

  const loop = (extra: LoopMsg[] = []) => runToolLoop({
    messages: [{ role: "system", content: system }, ...messages, ...extra] as LoopMsg[],
    complete: async (msgs) => {
      const c = await groqComplete(apiKey, { messages: msgs, tools, tool_choice: "auto", temperature: 0.3, max_tokens: 700 } as never);
      return { content: c.content, toolCalls: c.toolCalls };
    },
    finalize: async (msgs) => {
      const c = await groqComplete(apiKey, {
        messages: [...msgs, { role: "system", content: "Pare de usar ferramentas. Em uma frase curta e falada, diga ao chefe o que já foi feito e o que ficou faltando." }] as never,
        temperature: 0.3, max_tokens: 300,
      } as never);
      return c.content;
    },
    execute: async (name, args) => {
      try {
        const r = name.startsWith("my_hub_") ? await executeMyHubTool(name, args, hubCtx)
          : name.startsWith("memory_") ? await executeMemoryTool(name, args, memCtx)
          : await executeCalendarTool(name, args, calCtx);
        if (memCtx.state.changed) { _memCache = null; _memGen++; }   // a próxima conversa já enxerga o que foi guardado ou esquecido
        if ((r as { needsLogin?: boolean })?.needsLogin) needsLogin = true;
        if (WRITE_DONE.has((r as { status?: string })?.status ?? "")) acted = true;
        return r;
      } catch (e) {
        if (e instanceof GoogleApiError && e.status === 401) { needsLogin = true; return { needsLogin: true, error: "A sessão do Google expirou." }; }
        throw e;
      }
    },
  });

  let result = await loop();

  // O modelo pediu [NEEDTOOLS] mesmo com ferramentas (ligamos só um conjunto e o pedido era de outro): liga todas, uma vez.
  const all: ToolSets = { calendar: true, myhub: myHubWriteConfigured(), memory: memoryConfigured() };
  // Só se NENHUMA escrita aconteceu (leituras e recusas não têm efeito): refazer depois de gravar duplicaria o registro.
  if (detectNeedTools(result.text) === "yes" && !acted && !hubCtx.state.uncertain && hubCtx.state.writes === 0 && (sets.calendar !== all.calendar || sets.myhub !== all.myhub || sets.memory !== all.memory)) {
    return replyWithTools(req, apiKey, messages, memories, all, undoIn);
  }
  const calls = [...result.calls];
  let steps = result.steps;
  let text = result.text;

  // Rede de proteção: disse que registrou/marcou/cancelou, o chefe pediu escrita e nada foi feito. Refaz uma vez.
  // (Não refaz se o My Hub não respondeu a tempo: ele pode ter gravado, e refazer duplicaria.)
  if (!acted && !hubCtx.state.uncertain && (calWrite || hubWrite || memCtx.saveIntent || memCtx.forgetIntent) && claimsWrite(text)) {
    result = await loop([{ role: "assistant", content: text }, { role: "user", content: CORRECTION }]);
    calls.push(...result.calls);
    steps += result.steps;
    text = result.text;
    if (!acted && claimsWrite(text)) text = "Não consegui concluir isso agora, chefe.";   // nunca dizer que fez sem ter feito
  }

  // Falou de memória e disse que fez, mas o pedido não foi dos que o servidor executa e nada foi gravado.
  if (!acted && sets.memory && !memCtx.saveIntent && !memCtx.forgetIntent && wantsMemoryTopic(messages) && claimsWrite(text)) {
    text = "Não guardei nem apaguei nada, chefe. Diz \"lembra que...\" ou \"esquece que...\" e eu faço.";
  }

  if (!text && result.hitLimit) {
    text = acted ? "Fiz parte do pedido, mas não consegui terminar. Confere lá, chefe." : "Não consegui concluir isso agora, chefe.";
  }
  if (detectNeedTools(text) === "yes") text = "Não consegui fazer isso agora, chefe.";   // o marcador interno nunca chega ao chefe
  return {
    text, needsLogin, acted, steps,
    tools: calls.map((c) => (c.ok ? c.name : `${c.name}:erro`)),
    undo: hubCtx.state.undone ? ("clear" as const) : hubCtx.state.undo ?? null,
  };
}

const memoryConfigured = () => !!(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY);

// Cache memórias por 5 min para não bater no Supabase a cada mensagem
let _memGen = 0;   // sobe a cada escrita: uma busca em voo iniciada antes não repõe o dado velho
let _memCache: { data: { content: string; category: string }[]; ts: number } | null = null;
async function getCachedMemories() {
  if (_memCache && Date.now() - _memCache.ts < 5 * 60 * 1000) return _memCache.data;
  // Não deixa o Supabase atrasar a resposta: passou de 600ms, segue sem memórias nesta vez.
  const gen = _memGen;
  const fetching = listMemoriesStrict(25).then((data) => { if (gen === _memGen) _memCache = { data, ts: Date.now() }; return data; });
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
    const { messages, stream, full: forceFull, undo: undoRaw } = await req.json();

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json({ error: "Payload inválido: messages é obrigatório." }, { status: 400 });
    }

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "GROQ_API_KEY não configurada no servidor." }, { status: 500 });
    }

    const t0 = Date.now();
    // `full`: o cliente já viu o modo conversa falhar (disse que fez sem ter ferramenta) e pede o prompt completo.
    const hubOn = myHubWriteConfigured();
    const plan = planTurn(messages, { myhubWrite: hubOn, memory: memoryConfigured() }, forceFull === true);
    const mode: PromptMode = plan.mode;
    // Conversa simples não precisa do My Hub: pula a ida ao servidor dele.
    const [memories, myhub] = await Promise.all([getCachedMemories(), mode === "full" ? getMyHubContext() : Promise.resolve(null)]);
    const ctxMs = Date.now() - t0;

    // Serviço local de voz: uma linha JSON por evento (lib/voicewire.ts). A decisão de rota é toda daqui: turno com
    // ferramentas vai pelo caminho completo (sem stream) e sai numa linha só; conversa sai em stream do modelo.
    if (stream === "ndjson") {
      const encoder = new TextEncoder();
      const everything: ToolSets = { calendar: true, myhub: hubOn, memory: memoryConfigured() };
      const body = new ReadableStream<Uint8Array>({
        async start(controller) {
          const write = (l: WireLine) => { try { controller.enqueue(encoder.encode(encodeLine(l))); } catch { /* cliente foi embora */ } };
          let meta: WireMeta = { mode };
          let chars = 0, steps = 1, retried = false, tools: string[] = [];
          const viaTools = async (sets: ToolSets) => {
            const r = await replyWithTools(req, apiKey, messages, memories, sets, parseUndo(undoRaw));
            meta = {
              mode: "full",
              ...(r.needsLogin ? { needsGoogleLogin: true } : {}),
              ...(r.acted ? { usedTools: true } : {}),
              ...(r.undo === "clear" ? { undoCleared: true } : r.undo ? { undo: r.undo } : {}),
            };
            tools = r.tools; steps = r.steps;
            return r.text;
          };
          try {
            if (plan.sets) {
              const text = await viaTools(plan.sets);
              chars = text.length;
              write({ t: text });
            } else {
              const { gen, head, mode: usedMode, retried: r1 } = await openReply(apiKey, messages, mode, memories, myhub);
              retried = r1;
              meta.mode = usedMode;
              let full = head;
              write({ t: head });
              try {
                for await (const piece of gen) { full += piece; write({ t: piece }); }
              } finally {
                await gen.return().catch(() => {});
              }
              chars = full.length;
              const wantsWrite = wantsCalendarWrite(messages) || wantsMyHubWrite(messages) || wantsMemorySave(messages) || wantsMemoryForget(messages);
              if (detectNeedTools(full) === "yes" || (claimsWrite(full) && wantsWrite)) {
                // Sem ferramentas o modelo pediu [NEEDTOOLS] (nunca falado) ou disse que fez sem fazer: refaz com todas.
                retried = true;
                write({ retry: true });
                const text = await viaTools(everything);
                chars += text.length;
                write({ t: text });
              }
            }
          } catch (e) {
            console.error("[Beto API] ndjson:", e);
            write({ t: "Desculpe, houve um erro na comunicação." });
          } finally {
            write({ meta });
            logMetric({ mode: meta.mode, stream: "ndjson", model: workingModel(), ctx_ms: ctxMs, total_ms: Date.now() - t0, chars, retried, steps, tools });
            try { controller.close(); } catch { /* já fechado */ }
          }
        },
      });
      return new NextResponse(body, {
        headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
      });
    }

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
    let acted = false;      // alguma ferramenta de ESCRITA executou com sucesso (agenda ou My Hub)
    let undoOut: UndoState | "clear" | null = null;
    let steps = 1;
    const everything: ToolSets = { calendar: true, myhub: hubOn, memory: memoryConfigured() };
    const viaTools = async (sets: ToolSets) => {
      const r = await replyWithTools(req, apiKey, messages, memories, sets, parseUndo(undoRaw));
      needsGoogleLogin = r.needsLogin;
      tools = r.tools;
      acted = r.acted;
      steps = r.steps;
      undoOut = r.undo;
      return r.text;
    };
    // Pedido de agenda ou de registro no My Hub: o prompt completo vai junto com as ferramentas do que foi pedido.
    // (`full` do cliente só força o prompt completo; não liga ferramentas por si.)
    if (plan.sets) {
      reply = await viaTools(plan.sets);
    } else {
      reply = await run(mode, myhub);
      if (detectNeedTools(reply) === "yes") {
        // O modelo sem ferramentas pediu [NEEDTOOLS]: refaz com todas.
        retried = true;
        usedMode = "full";
        reply = await viaTools(everything);
      } else if (claimsWrite(reply) && (wantsCalendarWrite(messages) || wantsMyHubWrite(messages) || wantsMemorySave(messages) || wantsMemoryForget(messages))) {
        // Disse que registrou/marcou sem ferramenta nenhuma: nada foi feito. Refaz com todas.
        retried = true;
        usedMode = "full";
        reply = await viaTools(everything);
      }
    }
    logMetric({ mode: usedMode, stream: false, model: workingModel(), ctx_ms: ctxMs, total_ms: Date.now() - t0, chars: reply.length, retried, steps, tools });
    return NextResponse.json({
      reply,
      ...(needsGoogleLogin ? { needsGoogleLogin: true } : {}),
      ...(acted ? { usedTools: true } : {}),               // algo JÁ foi gravado: o cliente não duvida da resposta
      ...(undoOut === "clear" ? { undoCleared: true } : undoOut ? { undo: undoOut } : {}),   // o navegador guarda o caminho de desfazer
    }, { headers: { "x-beto-model": workingModel() ?? "" } });
  } catch (error: unknown) {
    console.error("[Beto API] Erro:", error);
    const message = error instanceof Error ? error.message : "Erro desconhecido.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
