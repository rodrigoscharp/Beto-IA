import { normalizarEntrada } from "@/lib/myhub-normalize";

/* Contexto do My Hub (treinos, finanças, metas, estudos…) para o Beto falar sabendo do dia do Rodrigo.
   Só leitura: o My Hub expõe /api/v1/service/beto-contexto protegido por token.
   Sem MYHUB_URL / MYHUB_SERVICE_TOKEN o Beto funciona igual, só sem esse contexto. */

const FRESH_MS = 2 * 60 * 1000;   // dentro disso, usa direto
const WAIT_MS  = 1500;            // primeira busca (sem cache): espera no máximo isso
const FETCH_MS = 6000;            // teto real da requisição ao My Hub

export interface MyHubRefs {
  contas: string[];
  categoriasDeDespesa: string[];
  categoriasDeReceita: string[];
  habitos: string[];
  projetos: string[];
  trilhas: string[];
}

export interface MyHubContext {
  hoje: string;
  entrevistasProximas: string[];
  /** Catálogo de ações que dá para registrar no My Hub (vem do My Hub; ausente em versões antigas). */
  acoes?: string;
  referencias?: MyHubRefs | null;
  topicos: Record<string, unknown>;
  indisponiveis: string[];
}

let cache: { data: MyHubContext; ts: number } | null = null;
let inflight: Promise<MyHubContext | null> | null = null;

export const myHubConfigured = () => !!(process.env.MYHUB_URL && process.env.MYHUB_SERVICE_TOKEN);

async function fetchContext(): Promise<MyHubContext | null> {
  const base = process.env.MYHUB_URL?.replace(/\/+$/, "");
  const token = process.env.MYHUB_SERVICE_TOKEN;
  if (!base || !token) return null;

  try {
    const res = await fetch(`${base}/api/v1/service/beto-contexto`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_MS),
    });
    if (!res.ok) {
      console.warn(`[Beto] My Hub respondeu ${res.status}`);
      return null;
    }
    const data = (await res.json()) as MyHubContext;
    cache = { data, ts: Date.now() };
    return data;
  } catch (e) {
    console.warn("[Beto] My Hub indisponível:", e instanceof Error ? e.message : e);
    return null;
  }
}

function refresh(): Promise<MyHubContext | null> {
  inflight ??= fetchContext().finally(() => { inflight = null; });
  return inflight;
}

/** Stale-while-revalidate: nunca segura a resposta do Beto por causa do My Hub. */
export async function getMyHubContext(): Promise<MyHubContext | null> {
  if (!myHubConfigured()) return null;

  if (cache) {
    if (Date.now() - cache.ts > FRESH_MS) void refresh();
    return cache.data;
  }

  const slow = new Promise<null>((r) => setTimeout(() => r(null), WAIT_MS));
  return Promise.race([refresh(), slow]);
}

/** Depois de registrar algo, o próximo "quanto gastei?" tem que ver o dado novo. */
export function invalidateMyHubContext() { cache = null; }

export const myHubWriteConfigured = () => !!(process.env.MYHUB_URL && process.env.MYHUB_WRITE_TOKEN);

export type MyHubWriteResult =
  | { ok: true; acao: { titulo: string; resumo: string; campos: { label: string; valor: string }[]; desfazer?: string } }
  | { ok: false; erro: string; incerto?: boolean };   // incerto: o My Hub pode ter gravado mesmo assim (demorou, caiu a conexão)

async function postWrite(path: string, body: unknown): Promise<Response> {
  const base = process.env.MYHUB_URL!.replace(/\/+$/, "");
  return fetch(`${base}/api/v1/service/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.MYHUB_WRITE_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
}

/** Registra algo no My Hub (o My Hub valida, resolve nomes e recusa o ambíguo). */
export async function myHubRegistrar(acao: string, entrada: unknown): Promise<MyHubWriteResult> {
  if (!myHubWriteConfigured()) return { ok: false, erro: "A escrita no My Hub não está configurada." };
  try {
    // MYHUB_DEFAULT_ACCOUNT: conta usada quando ele não diz qual (evita perguntar "Carteira ou PJ?" toda vez).
    const dados = normalizarEntrada(acao, entrada, { conta: process.env.MYHUB_DEFAULT_ACCOUNT });
    const res = await postWrite("beto-acao", { acao, entrada: dados });
    if (!res.ok) return { ok: false, erro: `O My Hub respondeu ${res.status}.`, ...(res.status >= 500 || res.status === 408 ? { incerto: true } : {}) };
    const data = (await res.json()) as MyHubWriteResult;
    if (data.ok) invalidateMyHubContext();
    return data;
  } catch {
    return { ok: false, erro: "Não consegui falar com o My Hub agora.", incerto: true };
  }
}

export async function myHubDesfazer(caminho: string): Promise<boolean> {
  if (!myHubWriteConfigured()) return false;
  try {
    const res = await postWrite("beto-desfazer", { desfazer: caminho });
    const ok = res.ok && ((await res.json()) as { ok?: boolean }).ok === true;
    if (ok) invalidateMyHubContext();
    return ok;
  } catch { return false; }
}
