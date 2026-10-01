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
  if (wantsCalendar(messages)) return true;     // agenda: ferramentas, nunca o streaming de conversa
  if (/\d/.test(text)) return true;           // número quase sempre é valor, hora ou quantidade: prompt completo

  // O Beto fez uma pergunta (em qualquer ponto do fim da fala) e a resposta curta é "sim", "pode", "quero"...:
  // provavelmente aceita uma oferta (briefing, email, ação). Resposta curta que não é sim/não segue como conversa.
  const prev = messages[lastUser - 1];
  if (prev && prev.role === "assistant" && words(text) < 6 && AFFIRMATIVE.test(text)
      && norm(prev.content).slice(-200).includes("?")) return true;

  return false;
}

/* ── Calendar ────────────────────────────────────────────────────────────── */

const CALENDAR_WORDS = new RegExp(
  "\\b(" + [
    "agenda\\w*", "agend\\w*", "evento\\w*", "reuni\\w*", "compromisso\\w*", "calendario", "marc\\w*", "remarc\\w*",
    "cancel\\w*", "desmarc\\w*", "adi\\w+ a reuni\\w*", "horario\\w*", "livre", "ocupad\\w*", "disponivel", "disponibilidade",
    "o que (eu )?tenho", "tenho (algo|algum|alguma|reuniao|compromisso)", "proximo evento", "proxima reuniao", "almoco", "cafe com",
  ].join("|") + ")\\b",
);

/** Pergunta do Beto sobre uma mudança na agenda (cancelar, remarcar, conflito): a resposta curta que vem depois é do Calendar. */
const CALENDAR_QUESTION = /(cancel|apag|remov|exclu|remarc|mov|alter|mud|troc|marc|conflit|agenda|reuni|evento|compromisso)/;

/** O pedido (ou a resposta curta a uma pergunta do Beto) é sobre agenda: as ferramentas do Calendar entram na conversa. */
export function wantsCalendar(messages: ChatMsg[]): boolean {
  let lastUser = -1;
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === "user") { lastUser = i; break; }
  if (lastUser < 0) return false;
  const text = norm(messages[lastUser].content);
  if (CALENDAR_WORDS.test(text)) return true;
  const prev = messages[lastUser - 1];
  if (prev && prev.role === "assistant" && words(text) < 6 && /^(sim|pode|claro|isso|ok|beleza|nao|negativo|aham|uhum|confirma)/.test(text)) {
    const p = norm(prev.content);
    return p.slice(-220).includes("?") && CALENDAR_QUESTION.test(p);
  }
  return false;
}

/* Confirmação para ações que não têm volta (cancelar evento, remarcar com convidados). Quem decide é o SERVIDOR,
   não o modelo: só vale se a última fala do chefe for um "sim" curto, sem restrição, logo depois de uma pergunta do Beto
   sobre cancelar/remarcar. "cancela a reunião" nunca confirma nada. */
const CONFIRM_START = /^(sim|pode|confirma\w*|claro|isso|ok|beleza|aham|uhum|fechado|com certeza|positivo|faz isso|vai la|manda ver)\b/;
const NEGATION = /\b(nao|mas|so que|espera|para|pera|deixa|depois)\b/;
const CONFIRM_QUESTION = /(cancel|apag|remov|exclu|remarc|mov|alter|mud|troc|confirm)/;

export function userConfirmed(messages: ChatMsg[]): boolean {
  let lastUser = -1;
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === "user") { lastUser = i; break; }
  if (lastUser < 1) return false;
  const text = norm(messages[lastUser].content);
  if (words(text) > 6 || !CONFIRM_START.test(text) || NEGATION.test(text)) return false;
  const prev = messages[lastUser - 1];
  if (!prev || prev.role !== "assistant") return false;
  const p = norm(prev.content);
  return p.slice(-220).includes("?") && CONFIRM_QUESTION.test(p);
}
