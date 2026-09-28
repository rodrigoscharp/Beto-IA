/* Contexto do My Hub (treinos, finanças, metas, estudos…) para o Beto falar sabendo do dia do Rodrigo.
   Só leitura: o My Hub expõe /api/v1/service/beto-contexto protegido por token.
   Sem MYHUB_URL / MYHUB_SERVICE_TOKEN o Beto funciona igual, só sem esse contexto. */

const FRESH_MS = 2 * 60 * 1000;   // dentro disso, usa direto
const WAIT_MS  = 1500;            // primeira busca (sem cache): espera no máximo isso
const FETCH_MS = 6000;            // teto real da requisição ao My Hub

export interface MyHubContext {
  hoje: string;
  entrevistasProximas: string[];
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

/** Bloco de texto para o system prompt. */
export function myHubPromptBlock(ctx: MyHubContext | null): string {
  if (!ctx) return "";
  const missing = ctx.indisponiveis.length
    ? `\nSeções que não carregaram agora (não invente, diga que não conseguiu ver): ${ctx.indisponiveis.join(", ")}.`
    : "";

  return `

━━━ CONTEXTO DO MY HUB (dados reais do Rodrigo, somente leitura) ━━━
O My Hub é onde o Rodrigo registra a vida dele: finanças, metas, hábitos, treinos, dieta, estudos, projetos, conteúdo, candidaturas e afazeres. Os dados abaixo estão atualizados até poucos minutos atrás (dia ${ctx.hoje}). Use-os para responder com contexto e personalizar conselhos: puxe o que for relevante ao assunto, sem despejar tudo. Os valores já vêm formatados em reais e datas dd/MM/aaaa: repita-os como estão, não faça contas. Para falar em voz alta, fale valores por extenso natural ("mil trezentos e dez reais"). Nunca invente dados que não estão aqui; se ele perguntar algo que não consta (outro mês, detalhe que não veio), diga que não consegue ver isso agora. Você só LÊ o My Hub: não consegue registrar, editar nem apagar nada lá. Se ele pedir para registrar algo, diga que por enquanto isso ele faz direto no My Hub. Transações com data futura são lançamentos recorrentes já agendados, não gastos já feitos. Sobre saúde e dinheiro, seja direto e útil, sem sermão.${missing}
DADOS: ${JSON.stringify({ entrevistasProximas: ctx.entrevistasProximas, ...ctx.topicos })}`;
}
