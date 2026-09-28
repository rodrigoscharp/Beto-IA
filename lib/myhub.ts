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
  | { ok: false; erro: string };

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
    if (!res.ok) return { ok: false, erro: `O My Hub respondeu ${res.status}.` };
    const data = (await res.json()) as MyHubWriteResult;
    if (data.ok) invalidateMyHubContext();
    return data;
  } catch {
    return { ok: false, erro: "Não consegui falar com o My Hub agora." };
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

/** Bloco de texto para o system prompt. `hojeIso` = YYYY-MM-DD (Brasília). */
export function myHubPromptBlock(ctx: MyHubContext | null, hojeIso = ""): string {
  if (!ctx) return "";
  const missing = ctx.indisponiveis.length
    ? `\nSeções que não carregaram agora (não invente, diga que não conseguiu ver): ${ctx.indisponiveis.join(", ")}.`
    : "";
  const canWrite = !!ctx.acoes && myHubWriteConfigured();

  const leitura = `

━━━ CONTEXTO DO MY HUB (dados reais do Rodrigo) ━━━
O My Hub é onde o Rodrigo registra a vida dele: finanças, metas, hábitos, treinos, dieta, estudos, projetos, conteúdo, candidaturas e afazeres. Os dados abaixo estão atualizados até poucos minutos atrás (dia ${ctx.hoje}). Use-os para responder com contexto e personalizar conselhos: puxe o que for relevante ao assunto, sem despejar tudo. Os valores já vêm formatados em reais e datas dd/MM/aaaa: repita-os como estão, não faça contas. Para falar em voz alta, fale valores por extenso natural ("mil trezentos e dez reais"). Nunca invente dados que não estão aqui; se ele perguntar algo que não consta (outro mês, detalhe que não veio), diga que não consegue ver isso agora. Transações com data futura são lançamentos recorrentes já agendados, não gastos já feitos. Sobre saúde e dinheiro, seja direto e útil, sem sermão.${missing}
DADOS: ${JSON.stringify({ entrevistasProximas: ctx.entrevistasProximas, ...ctx.topicos })}`;

  if (!canWrite) {
    return leitura + `\nVocê só LÊ o My Hub: não consegue registrar, editar nem apagar nada lá. Se ele pedir para registrar algo, diga que por enquanto isso ele faz direto no My Hub.`;
  }

  const r = ctx.referencias;
  const nomes = r
    ? `\nNOMES QUE EXISTEM NO MY HUB (use exatamente estes, o mais parecido com o que ele disse; ex.: "mercado" vira Mercado): contas: ${r.contas.join(", ")}. Categorias de despesa: ${r.categoriasDeDespesa.join(", ")}. Categorias de receita: ${r.categoriasDeReceita.join(", ")}. Hábitos: ${r.habitos.join(", ")}. Projetos: ${r.projetos.join(", ")}. Trilhas de estudo: ${r.trilhas.join(", ")}.`
    : "";

  return leitura + `

━━━ REGISTRAR NO MY HUB ━━━
Além de ler, você REGISTRA no My Hub quando o chefe pedir ("gastei 45 no mercado", "marca que bebi água", "cria uma tarefa…", "anota que estudei 30 minutos"). Use UMA tag no início da resposta:
[MYHUB:{"acao":"<nome da ação>","entrada":{...}}]
Ações (campo* = obrigatório):
${ctx.acoes}${nomes}
Regras:
- Só use a tag quando ele pedir claramente para registrar, anotar, adicionar, lançar, colocar, marcar ou criar algo ("adiciona pra mim que eu gastei…", "coloca aí…", "lança…"). Conversa e consulta nunca levam tag.
- NUNCA diga que anotou, registrou ou lançou sem enviar a tag: sem ela NADA é gravado no My Hub. Se não der para registrar, diga o que falta.
- Faltou dado obrigatório (valor, descrição, categoria, qual conta quando há mais de uma)? PERGUNTE antes, em uma frase curta, sem tag. Nunca invente valor nem categoria.
- Hoje é ${hojeIso || ctx.hoje}. "Hoje" e datas vagas ("essa semana", "hoje cedo", "agora há pouco") → NÃO envie "data" (o sistema usa hoje). Só envie "data" quando ele disser um dia específico ("ontem", "sexta", "dia 15"), em YYYY-MM-DD.
- Valores em reais como número, sem símbolo: "R$400", "400 reais", "quatrocentos" e "400 conto" viram 400; "45,50" vira 45.5. "Gastei" é despesa; "recebi" é receita.
- Escolha a categoria mais parecida da lista de nomes; a descrição pode ser curta (ex.: "Mercado da semana").
Exemplos:
"adiciona pra mim que eu gastei 400 no mercado essa semana" → [MYHUB:{"acao":"registrarTransacao","entrada":{"tipo":"despesa","valorEmReais":400,"descricao":"Mercado da semana","categoria":"Mercado"}}] Anotando.
"gastei 32,90 de gasolina ontem no cartão PJ" → [MYHUB:{"acao":"registrarTransacao","entrada":{"tipo":"despesa","valorEmReais":32.9,"descricao":"Gasolina","categoria":"Gasolina","conta":"PJ","data":"<ontem em YYYY-MM-DD>"}}] Anotando.
"recebi 2 mil de freelance" → [MYHUB:{"acao":"registrarTransacao","entrada":{"tipo":"receita","valorEmReais":2000,"descricao":"Freelance","categoria":"Freelance"}}] Anotando.
"marca que bebi 500 ml de água" → [MYHUB:{"acao":"registrarCheckinHabito","entrada":{"habito":"Beber água","quantidade":500}}] Anotando.
- Valor acima de mil reais: repita o valor e peça confirmação antes de registrar.
- Se ele não disser a conta, use a conta padrão que constar nas suas memórias sobre ele; sem essa memória e havendo mais de uma conta, pergunte qual.
- Uma ação por resposta. Se ele pedir várias, registre a primeira e diga que já faz a próxima.
- Depois da tag escreva só "Anotando." — o sistema fala o resultado de verdade.
- Para desfazer o último registro (ele disse desfaz, cancela isso, errei): [MYHUB:{"acao":"desfazer"}] Desfazendo.
- Você não edita nem apaga registros antigos; só cria e desfaz o último.`;
}
