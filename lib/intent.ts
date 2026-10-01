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
    // Registros no passado e valores ("almocei 35 reais", "fui na academia", "corri 5 km")
    "almoc\\w*", "jantei", "cafe da manha", "corri", "corrida", "academia", "malhei", "caminhei", "pedalei", "nadei",
    "medit\\w*", "dormi", "reais", "real", "conto", "pila", "dolar\\w*", "euros?", "quilometr\\w*", "km", "uber", "mercado",
    "pagu\\w*", "pago", "conta de \\w+",
    // Controle de música e leitura de email ditos de outro jeito
    "coloc\\w*", "bota\\w*", "poe", "abaixa\\w*", "aumenta\\w*", "diminui\\w*", "mais alto", "mais baixo", "silencio",
    "le", "leia", "abre", "abra",
    // Dia a dia
    "meu dia", "minha agenda", "minhas tarefas", "daqui",
  ].join("|") + ")\\b",
);

const AFFIRMATIVE = /^(sim|pode|quero|claro|manda|bora|vai|isso|ok|beleza|aham|uhum|fechado|por favor|nao|negativo)\b/;

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
  if (/\d/.test(text)) return true;           // número quase sempre é valor, hora ou quantidade: prompt completo

  // O Beto fez uma pergunta (em qualquer ponto do fim da fala) e a resposta curta é "sim", "pode", "quero"...:
  // provavelmente aceita uma oferta (briefing, email, ação). Resposta curta que não é sim/não segue como conversa.
  const prev = messages[lastUser - 1];
  if (prev && prev.role === "assistant" && words(text) < 6 && AFFIRMATIVE.test(text)
      && norm(prev.content).slice(-200).includes("?")) return true;

  return false;
}
