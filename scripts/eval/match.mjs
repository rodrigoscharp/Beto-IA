/* Comparador da bateria de avaliação: o que o modelo fez contra o que o caso espera. Puro, sem rede. */
import { EVAL_AREAS } from "../../lib/ops.ts";

const DROP = 0.05;            // queda: mais de 5 pontos percentuais abaixo do baseline
const NOT_RUN = 0.2;          // mais de 20% dos casos com erro: a noite não vale
const KINDS = ["ferramenta", "nenhumaFerramenta", "needTools", "tag"];

export function parseRegex(s) {
  const m = typeof s === "string" ? /^\/([\s\S]*)\/([a-z]*)$/.exec(s) : null;
  return m ? new RegExp(m[1], m[2]) : null;
}

const getPath = (obj, path) => path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
const asNumber = (v) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN);

function matchValue(exp, act) {
  if (typeof exp === "number") return asNumber(act) === exp;
  if (typeof exp === "boolean") return act === exp;
  if (typeof exp === "string") {
    const re = parseRegex(exp);
    if (!re) return act === exp;
    return act !== null && act !== undefined && re.test(typeof act === "string" ? act : JSON.stringify(act));
  }
  if (exp && typeof exp === "object") {
    const n = asNumber(act);
    return Number.isFinite(n) && (exp.min === undefined || n >= exp.min) && (exp.max === undefined || n <= exp.max);
  }
  return false;
}

const argsMatch = (exp, args) => args !== null && typeof args === "object" && Object.entries(exp).every(([p, v]) => matchValue(v, getPath(args, p)));

const short = (s, n = 160) => (s.length > n ? s.slice(0, n) + "…" : s);
function describe(r) {
  if (r.toolCalls.length) return r.toolCalls.map((c) => c.name).join(", ");
  if (r.needTools) return "[NEEDTOOLS]";
  return `texto "${short(r.text.trim(), 80)}"`;
}

export function matchCase(caso, r) {
  const proibida = r.toolCalls.find((c) => (caso.nunca ?? []).includes(c.name));
  if (proibida) return { ok: false, motivo: `chamou ${proibida.name}, que é proibida neste caso` };
  const e = caso.espera;
  if (e.ferramenta) {
    const cands = r.toolCalls.filter((c) => c.name === e.ferramenta);
    if (!cands.length) return { ok: false, motivo: `esperava ${e.ferramenta}, veio ${describe(r)}` };
    if (e.args && !cands.some((c) => argsMatch(e.args, c.args))) {
      return { ok: false, motivo: `${e.ferramenta} com args diferentes: ${short(JSON.stringify(cands[0].args))}` };
    }
    return { ok: true, motivo: "" };
  }
  if (e.nenhumaFerramenta) {
    if (r.toolCalls.length || r.needTools || !r.text.trim()) return { ok: false, motivo: `esperava só texto, veio ${describe(r)}` };
    return { ok: true, motivo: "" };
  }
  if (e.needTools) return r.needTools ? { ok: true, motivo: "" } : { ok: false, motivo: `esperava [NEEDTOOLS], veio ${describe(r)}` };
  if (e.tag) {
    // Mesmo formato que o app aceita (app/page.tsx, TAG): [TAG:{json}] exato. Tag fora disso não executa nada.
    const m = new RegExp(`\\[${e.tag}:(\\{[\\s\\S]*?\\})\\]`).exec(r.text);
    let json = !!m;
    if (m) { try { JSON.parse(m[1]); } catch { json = false; } }
    if (!m || !json) return { ok: false, motivo: `esperava a tag [${e.tag}:{…}] com JSON válido, veio ${describe(r)}` };
    if (e.conteudo && !parseRegex(e.conteudo).test(m[1])) return { ok: false, motivo: `tag [${e.tag}] com conteúdo diferente: ${short(m[1])}` };
    return { ok: true, motivo: "" };
  }
  return { ok: false, motivo: "caso sem expectativa" };
}

export function majority(results) {
  const ok = results.filter((x) => x.ok).length;
  if (ok * 2 > results.length) return { ok: true, motivo: "" };
  const falha = results.find((x) => !x.ok);
  return { ok: false, motivo: `${ok}/${results.length} tentativas certas; ${falha?.motivo ?? ""}` };
}

const rate = (ok, n) => (n ? Math.round((ok / n) * 1000) / 1000 : 0);

export function score(rows) {
  const per = {};
  let ok = 0, falhou = 0, erro = 0;
  for (const r of rows) {
    if (r.status === "erro") { erro++; continue; }
    per[r.area] ??= { ok: 0, n: 0 };
    per[r.area].n++;
    if (r.status === "ok") { ok++; per[r.area].ok++; } else falhou++;
  }
  const areas = Object.fromEntries(Object.entries(per).map(([a, v]) => [a, rate(v.ok, v.n)]));
  return { total: rate(ok, ok + falhou), areas, ok, falhou, erro, n: rows.length };
}

export const notRun = (sc) => sc.n === 0 || sc.erro / sc.n > NOT_RUN;
export const isDrop = (sc, base) => !!base && sc.total < base.total - DROP - 1e-9;
export const exitCode = (sc, base) => (notRun(sc) ? 2 : isDrop(sc, base) ? 1 : 0);

/** A área com a maior queda em relação ao baseline (ou a pior nota, sem baseline). */
export function worstArea(sc, base) {
  const entries = Object.entries(sc.areas);
  if (!entries.length) return null;
  const delta = ([a, v]) => (base?.areas?.[a] ?? 1) - v;
  return entries.sort((x, y) => delta(y) - delta(x))[0][0];
}

export function validateCases(cases, toolNames) {
  const erros = [];
  const ids = new Set();
  for (const c of cases) {
    const id = c?.id ?? "?";
    const err = (m) => erros.push(`${id}: ${m}`);
    if (typeof c?.id !== "string" || !c.id) err("sem id");
    else if (ids.has(c.id)) err("id repetido");
    ids.add(c?.id);
    if (!EVAL_AREAS.includes(c?.area)) err(`área inválida "${c?.area}"`);
    if (!Array.isArray(c?.conversa) || !c.conversa.length || c.conversa.at(-1)?.role !== "user") err("conversa vazia ou sem fala do usuário no fim");
    else if (c.conversa.some((m) => !["user", "assistant"].includes(m.role) || typeof m.content !== "string")) err("mensagem inválida na conversa");
    const e = c?.espera ?? {};
    const kinds = KINDS.filter((k) => e[k] !== undefined);
    if (kinds.length !== 1) err(`espera precisa de exatamente um de ${KINDS.join(", ")}`);
    if (e.ferramenta !== undefined && !toolNames.includes(e.ferramenta)) err(`ferramenta inexistente ${e.ferramenta}`);
    for (const n of c?.nunca ?? []) if (!toolNames.includes(n)) err(`ferramenta inexistente em nunca: ${n}`);
    const regexes = [e.conteudo, ...Object.values(e.args ?? {})].filter((v) => typeof v === "string" && v.startsWith("/"));
    for (const r of regexes) { try { if (!parseRegex(r)) err(`regex mal formada ${r}`); } catch { err(`regex inválida ${r}`); } }
    if (c?.repete !== undefined && !(Number.isInteger(c.repete) && c.repete >= 1 && c.repete <= 3)) err("repete deve ser 1, 2 ou 3");
  }
  return erros;
}
