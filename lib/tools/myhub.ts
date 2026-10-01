/* Ferramentas do My Hub para o modelo (registrar gasto, receita, hábito, tarefa; desfazer o último).
   O My Hub continua sendo quem valida: resolve nomes, recusa o ambíguo e devolve o motivo, que volta ao modelo para
   ele perguntar o que falta. O servidor impõe, sem confiar no modelo:
   - só registra se o chefe PEDIU registrar (writeIntent);
   - dinheiro é lido de forma ESTRITA e varrendo a entrada inteira (qualquer profundidade, qualquer chave de valor e
     qualquer número alto fora da lista de campos seguros); o My Hub recebe o NÚMERO já interpretado, na mesma chave;
   - valor acima de R$ 1.000 só com o "sim" do chefe a uma pergunta cuja última frase CONTÉM a frase exata que o servidor
     gera (ação, valor, tipo, descrição, categoria, conta e data): o "sim" vale para aquele registro e nenhum outro;
   - no máximo 3 registros por mensagem, nenhum duplicado, e nenhum depois de um registro incerto;
   - desfazer só com pedido de desfazer e registro recente (o navegador guarda o caminho e o reenvia). */

import { normalizarEntrada } from "../myhub-normalize";
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
          entrada: { type: "object", description: "Campos da ação, como no catálogo. Valores em reais como NÚMERO." },
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
const MAX_VALUE = 10_000_000;

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

/* minúsculo, sem acento nem pontuação */
const plain = (x: string) => x.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
/** Texto como vai para a pergunta: sem ".", "!" e "?" (não quebram a frase em duas) e sem " ou " (senão o "sim" nunca confirma). */
const clean = (x: string) => x.replace(/[.!?]/g, "").replace(/\bou\b/gi, "/").replace(/\s+/g, " ").trim();

/** Última frase do Beto, que precisa ser a pergunta de confirmação. */
function lastQuestion(text: string): string {
  const parts = text.split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);
  const last = parts[parts.length - 1] ?? "";
  return last.endsWith("?") ? last : "";
}

/* Chaves cujo valor é dinheiro. Casa por trecho (valorTotal, valorParcela, precoUnitario, custo…), em qualquer caixa. */
const MONEY_KEY = /(valor|preco|price|amount|quantia|total|custo|gasto|montante|parcela|aporte|saldo|pagamento|renda|centavos)/i;
/* Números que NÃO são dinheiro (podem passar de 1.000 sem confirmação). Qualquer outro número alto é tratado como dinheiro. */
const SAFE_NUMERIC = /^(quantidade|quantity|qtd|minutos|duracao|segundos|horas|dias|repeticoes|series|peso|km|metros|calorias|ml|litros|ordem|prioridade|nota|pontos|ano|id|parcelas|numparcelas|numeroparcelas|nparcelas)$/i;

interface Money { parent: Args; key: string; reais: number; strictKey: boolean }

/** Varre a entrada (qualquer profundidade, arrays inclusos), normaliza cada campo de valor NA MESMA CHAVE (número) e
    devolve o que achou. `invalid`: um campo de valor que não é um número claro e positivo. */
function scanMoney(node: unknown, found: Money[], depth = 0): string | null {
  if (depth > 5) return null;
  if (Array.isArray(node)) {
    for (const item of node.slice(0, 50)) { const bad = scanMoney(item, found, depth + 1); if (bad) return bad; }
    return null;
  }
  if (!isObj(node)) return null;
  for (const [key, v] of Object.entries(node)) {
    if (v && typeof v === "object") { const bad = scanMoney(v, found, depth + 1); if (bad) return bad; continue; }
    if (v === undefined || v === null) continue;
    if (SAFE_NUMERIC.test(key)) continue;
    if (MONEY_KEY.test(key)) {
      const n = amountOf(v);
      if (n === undefined) return key;
      const reais = /centavos/i.test(key) ? n / 100 : n;
      node[key] = /centavos/i.test(key) ? Math.round(n) : Math.round(n * 100) / 100;   // número, 2 casas (centavos inteiros)
      found.push({ parent: node, key, reais: Math.round(reais * 100) / 100, strictKey: true });
    } else {
      const n = typeof v === "number" ? v : typeof v === "string" ? amountOf(v) : undefined;
      if (n !== undefined && Number.isFinite(n) && n > HIGH_VALUE) found.push({ parent: node, key, reais: n, strictKey: false });
    }
  }
  return null;
}

export async function executeMyHubTool(name: string, args: unknown, ctx: MyHubCtx): Promise<unknown> {
  if (!ctx.api) return fail("O My Hub não está configurado para registrar.");
  if (name !== "my_hub_register" && name !== "my_hub_undo") return fail(`Ferramenta desconhecida: ${name}.`);
  if (!isObj(args)) return fail("Os argumentos precisam ser um objeto.");
  const api = ctx.api;

  if (name === "my_hub_undo") {
    if (!ctx.undoIntent) return fail("O chefe não pediu para desfazer nada.");
    // O registro feito nesta mesma mensagem tem prioridade; depois de desfazer, não cai no registro antigo do navegador.
    const u = "undo" in ctx.state ? ctx.state.undo : ctx.undo;
    if (!u || ctx.nowMs - u.ts > UNDO_WINDOW_MS) return { status: "nothing_to_undo", message: "Não há registro recente para desfazer." };
    if (!u.path) return { status: "cannot_undo", message: "Esse registro não dá para desfazer por voz; é direto no My Hub." };
    if (!(await api.undo(u.path))) return { status: "failed", error: "Não consegui desfazer agora." };
    ctx.state.undone = true;
    ctx.state.undo = null;
    return { status: "undone", resumo: u.resumo };
  }

  // my_hub_register
  if (!ctx.writeIntent) return fail("O chefe não pediu para registrar nada agora.");
  const rawAcao = args.acao;
  if (typeof rawAcao !== "string" || !/^[A-Za-z]{3,40}$/.test(rawAcao)) return fail("acao inválida: use o nome da ação do catálogo (só letras).");
  let acao: string = rawAcao;
  if (!isObj(args.entrada)) return fail("entrada precisa ser um objeto com os campos da ação.");
  if (ctx.state.uncertain) return fail("O registro anterior ficou incerto (o My Hub demorou); confira no My Hub antes de registrar de novo.");
  if (acao.toLowerCase() === "registrartransacao") acao = "registrarTransacao";
  else if (acao.toLowerCase() === "registrarcheckinhabito") acao = "registrarCheckinHabito";

  // Cópia: nunca altera o objeto do modelo; tudo daqui para a frente é o que o My Hub vai receber.
  let entrada = structuredClone(args.entrada) as Args;   // (JSON perderia NaN/Infinity: viram null e escapariam da checagem de valor)
  const found: Money[] = [];
  const bad = scanMoney(entrada, found);
  if (bad) return fail(`valor inválido em "${bad}": mande o valor como número em reais (ex.: 45.5), sem texto como "mil" ou "1k".`);
  const distinct = new Set(found.filter((f) => f.strictKey).map((f) => f.reais));
  if (distinct.size > 1) return fail("Campos de valor conflitantes na entrada (números diferentes): mande um só valor.");
  const reais = found.length ? Math.max(...found.map((f) => f.reais)) : undefined;
  if (reais !== undefined && reais > MAX_VALUE) return fail("valor alto demais para registrar por voz; faça direto no My Hub.");

  // O tipo vale o que o My Hub vai gravar (credito -> receita, gasto -> despesa), não o texto que o modelo mandou.
  entrada = normalizarEntrada(acao, entrada, {});
  const tipo = typeof entrada.tipo === "string" ? entrada.tipo : undefined;
  if (acao === "registrarTransacao" && reais !== undefined && reais > HIGH_VALUE && tipo !== "despesa" && tipo !== "receita") {
    return fail("tipo precisa ser despesa ou receita para registrar esse valor.");
  }

  const key = `${acao}:${stable(entrada)}`;
  if (ctx.state.seen.includes(key)) return fail("Esse registro já foi feito nesta mensagem.");
  if (ctx.state.writes >= MAX_WRITES) return fail("Só três registros por mensagem; peça o resto em outra mensagem.");

  let highValue = false;
  if (reais !== undefined && reais > HIGH_VALUE) {
    if (ctx.state.highDone) return fail("Só um registro de valor alto por mensagem; confirme o próximo em outra mensagem.");
    const str = (k: string) => (typeof entrada[k] === "string" && (entrada[k] as string).trim() ? clean(entrada[k] as string) : "");
    const label = acao === "registrarTransacao" ? (tipo === "receita" ? "uma receita" : "uma despesa") : `a ação ${acao}`;
    const core = `Registro ${label} de ${brl(reais)}`
      + (str("descricao") ? ` (${str("descricao")})` : "")
      + (str("categoria") ? ` em ${str("categoria")}` : "")
      + (str("conta") ? `, na conta ${str("conta")}` : "")
      + (str("data") ? `, em ${str("data")}` : "");
    const question = lastQuestion(ctx.lastAssistant);
    // O "sim" só vale se a última frase do Beto TERMINA exatamente neste registro (palavra inteira, sem acento/pontuação).
    // (A frase PODE ter palavras antes, "Chefe, registro…", mas TERMINA no registro: detalhe a mais depois dele é outro registro.)
    const ok = ctx.confirmed && question !== "" && ` ${plain(question)}`.endsWith(` ${plain(core)}`);
    if (!ok) {
      return {
        status: "needs_confirmation",
        ask_with: `${core}?`,
        instruction: "Valor acima de R$ 1.000: peça a confirmação ao chefe usando EXATAMENTE a frase de ask_with, com os números em algarismos (nada de valor por extenso), e só chame esta ferramenta de novo depois do sim dele. Não diga que já registrou.",
      };
    }
    highValue = true;
  }

  const res = await api.register(acao, entrada);
  if (!res.ok && res.incerto) {
    // O My Hub pode ter gravado e só a resposta não chegou: repetir duplicaria o gasto.
    ctx.state.writes++;
    ctx.state.seen.push(key);
    ctx.state.uncertain = true;
    if (highValue) ctx.state.highDone = true;
    return { status: "uncertain", message: "Não deu para confirmar se o My Hub registrou (ele demorou a responder). Peça ao chefe para conferir no My Hub antes de repetir; não diga que registrou." };
  }
  if (!res.ok) {
    return { status: "failed", error: res.erro, instruction: "Explique ao chefe em uma frase curta e pergunte só o que falta. Não diga que registrou." };
  }
  ctx.state.writes++;
  ctx.state.seen.push(key);
  if (highValue) ctx.state.highDone = true;
  ctx.state.undo = { path: res.acao.desfazer ?? null, resumo: res.acao.resumo, ts: ctx.nowMs };
  return { status: "registered", resumo: res.acao.resumo, campos: res.acao.campos, can_undo: !!res.acao.desfazer };
}
