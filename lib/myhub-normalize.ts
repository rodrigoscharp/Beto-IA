/* Modelos erram o formato ("400 reais", "essa semana", "gasto"). Antes de mandar ao My Hub, normaliza o que dá
   para inferir com segurança e descarta o que é vago demais (data vaga = hoje). Puro, sem rede. */

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const BR  = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

/** "R$ 1.200,50", "400,5", "quatrocentos" (não), 400 → número; inválido → undefined */
export function parseReais(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? v : undefined;
  if (typeof v !== "string") return undefined;
  const m = v.replace(/r\$|reais|real|conto|pila/gi, "").trim();
  if (!/^[\d.,\s]+$/.test(m) || !/\d/.test(m)) return undefined;
  const norm = m.includes(",") ? m.replace(/\./g, "").replace(",", ".") : m.replace(/\s/g, "");
  const n = Number(norm.replace(/\s/g, ""));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function normalizeDate(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  if (ISO.test(s)) return s;
  const br = s.match(BR);
  return br ? `${br[3]}-${br[2]!.padStart(2, "0")}-${br[1]!.padStart(2, "0")}` : undefined;
}

const clean = (v: unknown) => (typeof v === "string" && v.trim() && !/^(null|undefined|nenhum|n\/a)$/i.test(v.trim()) ? v.trim() : undefined);

const DESPESA = /^(despesa|gasto|gastei|saida|saída|saiu|compra|pagamento|debito|débito)$/i;
const RECEITA = /^(receita|entrada|ganho|recebi|recebimento|renda|credito|crédito)$/i;

export function normalizarEntrada(acao: string, entrada: unknown, defaults: { conta?: string } = {}): Record<string, unknown> {
  const e: Record<string, unknown> = entrada && typeof entrada === "object" ? { ...(entrada as Record<string, unknown>) } : {};

  // Datas: só valem se forem datas de verdade. "essa semana", "hoje cedo" → sem data (o My Hub usa hoje).
  for (const campo of ["data", "prazo"]) {
    if (campo in e) {
      const d = normalizeDate(e[campo]);
      if (d) e[campo] = d; else delete e[campo];
    }
  }

  // Textos vazios ou "null" viram ausentes
  for (const [k, v] of Object.entries(e)) {
    if (typeof v === "string") { const c = clean(v); if (c === undefined) delete e[k]; else e[k] = c; }
    else if (v === null) delete e[k];
  }

  if (acao === "registrarTransacao") {
    const v = parseReais(e.valorEmReais ?? e.valor);
    if (v !== undefined) e.valorEmReais = v;
    delete e.valor;

    if (typeof e.tipo === "string") {
      e.tipo = DESPESA.test(e.tipo) ? "despesa" : RECEITA.test(e.tipo) ? "receita" : e.tipo;
    } else if (e.tipo === undefined) {
      e.tipo = "despesa"; // "gastei", "adiciona um gasto": quem recebe diz "recebi"
    }
    if (!e.descricao && typeof e.categoria === "string") e.descricao = e.categoria;
    if (!e.conta && defaults.conta) e.conta = defaults.conta;
  }

  if (acao === "registrarCheckinHabito") {
    if (typeof e.quantidade === "string") { const n = Number(e.quantidade.replace(",", ".")); if (Number.isFinite(n)) e.quantidade = Math.round(n); else delete e.quantidade; }
    if (typeof e.folga === "string") e.folga = /^(true|sim|1)$/i.test(e.folga);
  }

  return e;
}
