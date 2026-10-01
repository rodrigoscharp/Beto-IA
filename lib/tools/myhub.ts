/* Ferramentas do My Hub para o modelo (registrar gasto, receita, hábito, tarefa; desfazer o último).
   O My Hub continua sendo quem valida: resolve nomes, recusa o ambíguo e devolve o motivo, que volta ao modelo para
   ele perguntar o que falta. O servidor impõe, sem confiar no modelo:
   - só registra se o chefe PEDIU registrar (writeIntent);
   - valor acima de R$ 1.000 só com o "sim" do chefe a uma pergunta que CITOU o valor;
   - no máximo 3 registros por mensagem e nenhum duplicado;
   - desfazer só com pedido de desfazer e registro recente (o navegador guarda o caminho e o reenvia). */

import { parseReais } from "../myhub-normalize";
import type { MyHubWriteResult } from "../myhub";
import type { ToolDef } from "./calendar";

export interface MyHubApi {
  register(acao: string, entrada: unknown): Promise<MyHubWriteResult>;
  undo(path: string): Promise<boolean>;
}

export interface UndoInfo { path: string | null; resumo: string; ts: number }

export interface MyHubCtx {
  api: MyHubApi | null;
  writeIntent: boolean;          // o chefe pediu para registrar (wantsMyHubWrite)
  undoIntent: boolean;           // o chefe pediu para desfazer (wantsMyHubUndo)
  confirmed: boolean;            // o chefe acabou de confirmar (userConfirmed)
  lastAssistant: string;         // a fala do Beto logo antes do "sim"
  undo: UndoInfo | null;         // último registro desfazível, reenviado pelo navegador
  nowMs: number;
  state: { writes: number; seen: string[]; undo?: UndoInfo | null; undone?: boolean; uncertain?: boolean; highDone?: boolean };
}

export const MYHUB_TOOLS: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "my_hub_register",
      description: "Registra algo no My Hub do chefe (gasto, receita, hábito, tarefa…). Use o nome da ação do catálogo e os nomes de contas e categorias que existem. Se faltar dado obrigatório, NÃO chame: pergunte ao chefe.",
      parameters: {
        type: "object",
        properties: {
          acao: { type: "string", description: "Nome da ação do catálogo, ex.: registrarTransacao" },
          entrada: { type: "object", description: "Campos da ação, como no catálogo" },
        },
        required: ["acao", "entrada"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "my_hub_undo",
      description: "Desfaz o último registro feito no My Hub (só se foi há pouco). Use quando o chefe disser desfaz, errei ou foi engano.",
      parameters: { type: "object", properties: {} },
    },
  },
];

const UNDO_WINDOW_MS = 15 * 60 * 1000;
const MAX_WRITES = 3;
const HIGH_VALUE = 1000;

type Args = Record<string, unknown>;
const fail = (error: string) => ({ error });
const isObj = (a: unknown): a is Args => !!a && typeof a === "object" && !Array.isArray(a);

function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (isObj(v)) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}`;
  return JSON.stringify(v);
}

/** Valor em reais, ESTRITO: só formatos sem ambiguidade. "1.500,50", "1.500", "45,5", "45.5", "R$ 30" -> número;
    "1,500", "1k", "2 mil", "mil e quinhentos", "1e4", negativo, zero -> undefined (o chamador recusa e pede um número). */
function amountOf(v: unknown): number | undefined {
  let n: number | undefined;
  if (typeof v === "number") n = v;
  else if (typeof v === "string") {
    const s = v.replace(/r\$|reais|real/gi, "").trim();
    if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(s)) n = Number(s.replace(/\./g, "").replace(",", "."));
    else if (/^\d+(,\d{1,2})?$/.test(s)) n = Number(s.replace(",", "."));
    else if (/^\d+(\.\d{1,2})?$/.test(s)) n = Number(s);
  }
  return n !== undefined && Number.isFinite(n) && n > 0 ? n : undefined;
}

const brl = (v: number) => {
  const [i, d] = v.toFixed(2).split(".");
  return `R$ ${i.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${d}`;
};

/** A fala do Beto citou exatamente este valor? ("R$ 1.500,00", "1500 reais", "1.500"). */
function amountMentioned(text: string, value: number): boolean {
  const found = text.toLowerCase().match(/\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:,\d{1,2})?/g) ?? [];
  return found.some((n) => { const x = amountOf(n); return x !== undefined && Math.abs(x - value) < 0.01; });
}

/* minúsculo, sem acento nem pontuação */
const plain = (x: string) => x.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
/** Texto de descrição/categoria como vai para a pergunta: sem "?" e sem " ou " (senão o "sim" nunca confirma). */
const clean = (x: string) => x.replace(/\?/g, "").replace(/\bou\b/gi, "/").replace(/\s+/g, " ").trim();

/** Última frase do Beto, que precisa ser a pergunta de confirmação. */
function lastQuestion(text: string): string {
  const parts = text.split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);
  const last = parts[parts.length - 1] ?? "";
  return last.endsWith("?") ? last : "";
}

const MONEY_KEY = /^(valor|valorEmReais|valorEmCentavos|quantia|amount|total|preco|price|montante)$/i;

/** Campos de valor da entrada, em REAIS. `invalid`: algum campo de valor existe mas não é um número claro e positivo. */
function moneyOf(entrada: Args): { reais: number | undefined; invalid: string | null } {
  let reais: number | undefined;
  for (const [k, v] of Object.entries(entrada)) {
    if (!MONEY_KEY.test(k) || v === undefined || v === null) continue;
    const n = /centavos/i.test(k) ? (() => { const c = amountOf(v); return c === undefined ? undefined : c / 100; })() : amountOf(v);
    if (n === undefined) return { reais: undefined, invalid: k };
    reais = Math.max(reais ?? 0, n);
  }
  return { reais, invalid: null };
}

export async function executeMyHubTool(name: string, args: unknown, ctx: MyHubCtx): Promise<unknown> {
  if (!ctx.api) return fail("O My Hub não está configurado para registrar.");
  if (name !== "my_hub_register" && name !== "my_hub_undo") return fail(`Ferramenta desconhecida: ${name}.`);
  if (!isObj(args)) return fail("Os argumentos precisam ser um objeto.");
  const api = ctx.api;

  if (name === "my_hub_undo") {
    if (!ctx.undoIntent) return fail("O chefe não pediu para desfazer nada.");
    const u = ctx.state.undo ?? ctx.undo;   // o registro feito nesta mesma mensagem tem prioridade sobre o antigo do navegador
    if (!u || ctx.nowMs - u.ts > UNDO_WINDOW_MS) return { status: "nothing_to_undo", message: "Não há registro recente para desfazer." };
    if (!u.path) return { status: "cannot_undo", message: "Esse registro não dá para desfazer por voz; é direto no My Hub." };
    if (!(await api.undo(u.path))) return { status: "failed", error: "Não consegui desfazer agora." };
    ctx.state.undone = true;
    ctx.state.undo = null;
    return { status: "undone", resumo: u.resumo };
  }

  // my_hub_register
  if (!ctx.writeIntent) return fail("O chefe não pediu para registrar nada agora.");
  const acao = args.acao;
  if (typeof acao !== "string" || !/^[A-Za-z]{3,40}$/.test(acao)) return fail("acao inválida: use o nome da ação do catálogo (só letras).");
  if (!isObj(args.entrada)) return fail("entrada precisa ser um objeto com os campos da ação.");
  const entrada = args.entrada;

  const key = `${acao}:${stable(entrada)}`;
  if (ctx.state.seen.includes(key)) return fail("Esse registro já foi feito nesta mensagem.");
  if (ctx.state.writes >= MAX_WRITES) return fail("Só três registros por mensagem; peça o resto em outra mensagem.");

  const { reais, invalid } = moneyOf(entrada);
  if (invalid) return fail(`valor inválido em "${invalid}": mande o valor como número em reais (ex.: 45.5), sem texto como "mil" ou "1k".`);
  // O My Hub recebe o número JÁ interpretado ("1.500" -> 1500), nunca o texto cru que ele poderia ler diferente.
  if (reais !== undefined && ("valorEmReais" in entrada || "valor" in entrada)) {
    entrada.valorEmReais = reais;
    delete entrada.valor;
  }
  if (reais !== undefined && reais > HIGH_VALUE) {
    if (ctx.state.highDone) return fail("Só um registro de valor alto por mensagem; confirme o próximo em outra mensagem.");
    const q = plain(lastQuestion(ctx.lastAssistant));
    const tipoReceita = typeof entrada.tipo === "string" && /receita|entrada|ganho|recebi/i.test(entrada.tipo);
    const campos = [entrada.categoria, entrada.descricao].filter((x): x is string => typeof x === "string" && x.trim() !== "");
    const bate = ctx.confirmed && q !== "" && amountMentioned(lastQuestion(ctx.lastAssistant), reais)
      && new RegExp(`(^| )${tipoReceita ? "receita" : "despesa"}( |$)`).test(q)
      && campos.every((c) => q.includes(plain(clean(c))));
    if (!bate) {
      const desc = typeof entrada.descricao === "string" && entrada.descricao.trim() ? ` (${clean(entrada.descricao)})` : "";
      const cat = typeof entrada.categoria === "string" && entrada.categoria.trim() ? ` em ${clean(entrada.categoria)}` : "";
      return {
        status: "needs_confirmation",
        ask_with: `Registro ${tipoReceita ? "uma receita" : "uma despesa"} de ${brl(reais)}${desc}${cat}?`,
        instruction: "Valor acima de R$ 1.000: peça a confirmação ao chefe usando EXATAMENTE a frase de ask_with, com os números em algarismos (nada de valor por extenso), e só chame esta ferramenta de novo depois do sim dele. Não diga que já registrou.",
      };
    }
    ctx.state.highDone = true;
  }

  const res = await api.register(acao, entrada);
  if (!res.ok && res.incerto) {
    // O My Hub pode ter gravado e só a resposta não chegou: repetir duplicaria o gasto.
    ctx.state.writes++;
    ctx.state.seen.push(key);
    ctx.state.uncertain = true;
    return { status: "uncertain", message: "Não deu para confirmar se o My Hub registrou (ele demorou a responder). Peça ao chefe para conferir no My Hub antes de repetir; não diga que registrou." };
  }
  if (!res.ok) {
    return { status: "failed", error: res.erro, instruction: "Explique ao chefe em uma frase curta e pergunte só o que falta. Não diga que registrou." };
  }
  ctx.state.writes++;
  ctx.state.seen.push(key);
  ctx.state.undo = { path: res.acao.desfazer ?? null, resumo: res.acao.resumo, ts: ctx.nowMs };
  return { status: "registered", resumo: res.acao.resumo, campos: res.acao.campos, can_undo: !!res.acao.desfazer };
}
