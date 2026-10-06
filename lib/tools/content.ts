/* Ferramenta de planos de conteúdo: busca no My Hub uma seção do plano (o roteiro do "Ep. 2", por exemplo) para o
   Beto explicar o que gravar. Só leitura. O contexto do My Hub traz só o índice dos planos (pendências e títulos);
   o texto de uma seção vem daqui, sob demanda, porque os planos inteiros estourariam o prompt. */

import type { ToolDef } from "./calendar";

export interface PlanoSecao { plano: string; titulo: string; texto: string }

export interface ContentApi {
  /** null = o My Hub não respondeu. */
  buscar(busca: string): Promise<{ secoes: PlanoSecao[] } | null>;
}

export interface ContentCtx {
  api: ContentApi | null;
  state: { calls: number };
}

export const CONTENT_TOOLS: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "content_plan",
      description: "Busca nos planos de conteúdo do My Hub uma seção pelo título (roteiro de episódio, pauta, semana padrão) e devolve o texto dela. Use para explicar o que o chefe precisa gravar ou postar.",
      parameters: {
        type: "object",
        properties: {
          busca: { type: "string", description: "Como ele chamou: \"ep 2\", \"episódio 3\", \"semana padrão\", \"oferta de fundador\"" },
        },
        required: ["busca"],
      },
    },
  },
];

const MAX_CALLS = 3;
const MAX_BUSCA = 120;
const MAX_TEXTO = 4000;   // uma seção de roteiro tem uns 1,5 KB; o teto só protege o prompt

export async function executeContentTool(name: string, args: unknown, ctx: ContentCtx) {
  if (name !== "content_plan") return { error: `Ferramenta desconhecida: ${name}` };
  const busca = (args as { busca?: unknown } | null)?.busca;
  if (typeof busca !== "string" || !busca.trim() || busca.length > MAX_BUSCA) {
    return { error: "Passe em busca o nome do episódio ou da seção, por exemplo \"ep 2\"." };
  }
  if (!ctx.api) return { error: "O My Hub não está configurado: não consigo ver os planos de conteúdo." };
  if (ctx.state.calls >= MAX_CALLS) return { error: "Já busquei o bastante nesta mensagem. Responda com o que achou." };
  ctx.state.calls++;

  const r = await ctx.api.buscar(busca.trim());
  if (!r) return { error: "Não consegui falar com o My Hub agora." };
  if (!r.secoes.length) {
    return { secoes: [], aviso: "Nada com esse nome nos planos. Diga isso ao chefe e não invente o roteiro; pergunte o nome como está no My Hub." };
  }
  return {
    secoes: r.secoes.map((s) => ({
      plano: s.plano,
      titulo: s.titulo,
      texto: s.texto.length > MAX_TEXTO ? `${s.texto.slice(0, MAX_TEXTO)}…(cortado)` : s.texto,
    })),
  };
}
