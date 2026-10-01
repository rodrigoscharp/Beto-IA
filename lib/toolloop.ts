/* Laço de chamada de ferramentas: o modelo pede ferramentas, o servidor executa, devolve os resultados ao modelo
   e repete até vir uma resposta em texto. Puro (modelo e execução entram de fora): testável sem rede. */

export interface LoopMsg {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

export interface ToolCallReq { id: string; name: string; arguments: string }
export interface AssistantTurn { content: string; toolCalls: ToolCallReq[] }

export interface LoopResult {
  text: string;                                   // vazio se bateu no limite de passos
  steps: number;
  calls: { name: string; ok: boolean }[];
  hitLimit: boolean;
}

const MAX_CALLS_PER_STEP = 4;
const MAX_RESULT_CHARS = 6000;

function pack(result: unknown): string {
  const s = JSON.stringify(result ?? null);
  return s.length <= MAX_RESULT_CHARS ? s : JSON.stringify({ truncated: true, partial: s.slice(0, MAX_RESULT_CHARS - 60) });
}

export async function runToolLoop(o: {
  messages: LoopMsg[];
  complete: (messages: LoopMsg[]) => Promise<AssistantTurn>;
  execute: (name: string, args: unknown, callId: string) => Promise<unknown>;
  maxSteps?: number;
  /** Chamado ao bater no limite de passos, com tudo o que já aconteceu: devolve uma resposta SEM chamar ferramentas
      (para o chefe não ouvir "não consegui" depois de a agenda já ter sido alterada). */
  finalize?: (messages: LoopMsg[]) => Promise<string>;
}): Promise<LoopResult> {
  const maxSteps = o.maxSteps ?? 4;
  const messages = [...o.messages];
  const calls: LoopResult["calls"] = [];

  for (let step = 1; step <= maxSteps; step++) {
    const turn = await o.complete(messages);
    if (turn.toolCalls.length === 0) return { text: turn.content.trim(), steps: step, calls, hitLimit: false };

    messages.push({
      role: "assistant",
      content: turn.content || null,
      tool_calls: turn.toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.arguments } })),
    });

    for (let i = 0; i < turn.toolCalls.length; i++) {
      const c = turn.toolCalls[i];
      let result: unknown;
      let ok = true;
      if (i >= MAX_CALLS_PER_STEP) {
        result = { error: "Muitas chamadas de uma vez; faça uma de cada vez." };   // toda chamada precisa de resposta
        ok = false;
      } else {
        let args: unknown;
        try {
          args = c.arguments.trim() ? JSON.parse(c.arguments) : {};
        } catch {
          args = undefined;
          result = { error: "Os argumentos não são um JSON válido." };
          ok = false;
        }
        if (ok) {
          try { result = await o.execute(c.name, args, c.id); }
          catch (e) { result = { error: e instanceof Error ? e.message : "erro ao executar a ferramenta" }; ok = false; }
        }
      }
      calls.push({ name: c.name, ok });
      messages.push({ role: "tool", tool_call_id: c.id, content: pack(result) });
    }
  }
  let text = "";
  if (o.finalize) {
    try { text = (await o.finalize(messages)).trim(); } catch { /* quem chamou decide a frase de desculpa */ }
  }
  return { text, steps: maxSteps, calls, hitLimit: true };
}
