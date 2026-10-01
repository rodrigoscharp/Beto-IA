/* Roteador de intenção: decide se o pedido precisa do prompt completo (tags de integração) ou se uma
   conversa simples basta. Conservador de propósito: na dúvida devolve `true` (prompt completo), porque
   errar para o lado "conversa" faz o Beto responder "não consigo" para um pedido que ele sabe fazer.
   Sem imports: roda no servidor, no navegador e nos testes. */

export interface ChatMsg { role: string; content: string }

const TOOL_WORDS = new RegExp(
  "\\b(" + [
    // Spotify
    "toca\\w*", "musica\\w*", "som", "pausa\\w*", "pause", "retoma\\w*", "continua\\w*", "proxima", "anterior",
    "volume", "shuffle", "aleatori\\w*", "playlist\\w*", "spotify", "album", "cantor\\w*", "banda",
    // Agenda
    "agenda\\w*", "evento\\w*", "reuni\\w*", "compromisso\\w*", "calendario", "marc\\w*", "remarc\\w*", "agend\\w*",
    // GitHub
    "github", "prs?", "pull", "issues?", "commits?", "repo\\w*", "branch", "merge\\w*", "deploy\\w*", "ci",
    // Gmail
    "e-?mails?", "gmail", "inbox", "caixa", "nao lid\\w*",
    // Timer
    "timer", "temporizador", "pomodoro", "cronometro", "minutos?", "segundos?",
    // Briefing
    "briefing", "resumo", "o que tenho",
    // Memória
    "lembr\\w*", "memoria\\w*", "anot\\w*", "guard\\w*", "salv\\w*", "esquec\\w*", "sabe sobre mim",
    // My Hub (gastos, hábitos, tarefas)
    "gast\\w*", "receb\\w*", "regist\\w*", "habito\\w*", "treino\\w*", "treinei", "estudei", "bebi", "paguei",
    "comprei", "tarefa\\w*", "meta\\w*", "saldo", "fatura\\w*", "financ\\w*", "orcamento", "my ?hub", "lanc\\w*",
  ].join("|") + ")\\b",
);

/* minúsculo, sem acento, sem a tag de emoção do histórico */
const norm = (s: string) =>
  s.replace(/\[\s*emo[^\]\n]*\]/gi, " ")
    .toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ").trim();

const words = (s: string) => (s ? s.split(" ").length : 0);

export function needsTools(messages: ChatMsg[]): boolean {
  let lastUser = -1;
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === "user") { lastUser = i; break; }
  if (lastUser < 0) return true;

  const raw = messages[lastUser].content;
  if (/^\s*\[SISTEMA\]/i.test(raw)) return true;
  const text = norm(raw);

  if (words(text) < 3) return true;           // "sim", "quero", "a segunda": pode responder a uma oferta
  if (TOOL_WORDS.test(text)) return true;

  // O Beto acabou de perguntar algo e a resposta é curta: pode ser "sim" para um briefing, um email, uma ação.
  const prev = messages[lastUser - 1];
  if (prev && prev.role === "assistant" && /\?\s*$/.test(norm(prev.content)) && words(text) < 6) return true;

  return false;
}
