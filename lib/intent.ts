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
  if (wantsMyHubWrite(messages) || wantsMyHubUndo(messages)) return true;   // registrar no My Hub: ferramentas
  if (/\d/.test(text)) return true;           // número quase sempre é valor, hora ou quantidade: prompt completo

  // O Beto fez uma pergunta (em qualquer ponto do fim da fala) e a resposta curta é "sim", "pode", "quero"...:
  // provavelmente aceita uma oferta (briefing, email, ação). Resposta curta que não é sim/não segue como conversa.
  const prev = messages[lastUser - 1];
  if (prev && prev.role === "assistant" && words(text) < 6 && AFFIRMATIVE.test(text)
      && norm(prev.content).slice(-200).includes("?")) return true;

  return false;
}

/* ── Calendar ────────────────────────────────────────────────────────────── */

const DAY_TIME = "amanha|hoje|segunda|terca|quarta|quinta|sexta|sabado|domingo|semana que vem|proxima semana|essa semana|esta semana|manha|tarde|noite|\\d{1,2}\\s?h(?:\\d{2})?|\\d{1,2}:\\d{2}";
const CAL_NOUN = "call|calls|meet|consulta|dentista|medico|reuniao|reunioes|almoco|cafe|jantar|compromisso|compromissos|evento|eventos|aula|encontro|entrevista|visita";
const MOVE_VERB = "muda|mude|mudar|passa|passe|joga|jogue|adia|adie|adiar|antecipa|antecipe|move|mova|mover|transfere|transfira|troca|troque";
const re = (src: string) => new RegExp(`\\b(?:${src})\\b`);
const HAS_DAY_TIME = re(DAY_TIME);
const HAS_CAL_NOUN = re(CAL_NOUN);

/* Verdadeiro quando a fala é, de fato, sobre agenda. "marca" (verbo) só conta junto de um evento ou horário: "a melhor
   marca de tênis" e "em março" (março normalizado vira "marco") não são agenda. */
function isCalendarTalk(text: string): boolean {
  const dayTime = HAS_DAY_TIME.test(text), noun = HAS_CAL_NOUN.test(text), either = dayTime || noun;
  if (/\b(agenda|agende|agendar|agendou|calendario)\b/.test(text)) return true;
  if (/\b(horarios?|janelas?)\s+livres?\b/.test(text) || /\bproxim[oa]s?\s+(evento|reuniao|compromisso|call)\b/.test(text)) return true;
  if (/\b(remarc\w*|reagend\w*|desmarc\w*)\b/.test(text)) return true;
  if (/\b(marca|marcar|marque|marcou)\b/.test(text) && either) return true;
  if (/\bcancel\w*\b/.test(text) && either) return true;
  if (re(MOVE_VERB).test(text) && either) return true;
  if (WRITE_VERB.test(text) && either) return true;           // cria, bota, apaga, exclui, renomeia... junto de evento ou horário
  if (/\blivres?\b/.test(text) && dayTime) return true;
  if (/\b(tenho|temos)\b/.test(text) && (/\b(compromisso\w*|reuniao|reunioes|evento\w*|call|consulta)\b/.test(text) || (/\bo que\b/.test(text) && dayTime))) return true;
  if (/\b(disponivel|disponibilidade|ocupad[oa])\b/.test(text) && dayTime) return true;
  return false;
}

/** Pergunta do Beto sobre uma mudança na agenda (cancelar, remarcar, conflito): a resposta curta que vem depois é do Calendar. */
const CALENDAR_QUESTION = /(cancel|apag|delet|remov|exclu|remarc|remarq|mov|alter|mud|troc|marc|marq|agend|cri|coloc|conflit|reuni|evento|compromisso)/;

function lastUserText(messages: ChatMsg[]): { text: string; index: number } | null {
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === "user") return { text: norm(messages[i].content), index: i };
  return null;
}

/** O pedido (ou a resposta curta a uma pergunta do Beto) é sobre agenda: as ferramentas do Calendar entram na conversa. */
export function wantsCalendar(messages: ChatMsg[]): boolean {
  const last = lastUserText(messages);
  if (!last) return false;
  if (isCalendarTalk(last.text)) return true;
  const prev = messages[last.index - 1];
  if (prev && prev.role === "assistant" && words(last.text) < 6 && /^(sim|pode|claro|isso|ok|beleza|nao|negativo|aham|uhum|confirma)/.test(last.text)) {
    const p = norm(prev.content);
    return p.slice(-220).includes("?") && CALENDAR_QUESTION.test(p);
  }
  return false;
}

/* Escrita na agenda (criar, mudar, cancelar) só é liberada quando o chefe PEDIU isso. Um pedido só de leitura
   ("o que tenho amanhã?") não pode virar alteração por causa de um título de evento escrito por terceiros. */
const WRITE_VERB = /\b(marca|marcar|marque|agende|agendar|agenda (?:um|uma|o|a|pra|para)|cria|criar|crie|adicion\w*|coloc\w*|bota\w*|poe|remarc\w*|reagend\w*|desmarc\w*|cancel\w*|apag\w*|exclu\w*|delet\w*|mud\w*|troc\w*|pass(?:a|e)|jog(?:a|ue)|adi(?:a|e|ar)|antecip\w*|mov(?:e|a|er)|transfer\w*|alter\w*|renome\w*)\b/;

export function wantsCalendarWrite(messages: ChatMsg[]): boolean {
  const last = lastUserText(messages);
  if (!last) return false;
  if (WRITE_VERB.test(last.text) && (isCalendarTalk(last.text) || HAS_DAY_TIME.test(last.text) || HAS_CAL_NOUN.test(last.text))) return true;
  return userConfirmed(messages);
}

/* Confirmação para ações que não têm volta (cancelar evento, remarcar com convidados, marcar por cima de conflito).
   Quem decide é o SERVIDOR, não o modelo. Vale só se a fala INTEIRA do chefe for uma afirmativa pura ("sim", "pode
   cancelar", "beleza pode"): "sim, apaga todas de amanhã" traz uma ordem nova e não confirma nada. E a última frase do
   Beto tem de ser a pergunta sobre a mudança. O servidor ainda confere se essa pergunta cita o evento (lib/tools). */
const CONFIRM_TOKENS = new Set(["sim", "pode", "confirma", "confirmo", "confirmado", "claro", "isso", "mesmo", "ok", "beleza", "aham", "uhum",
  "fechado", "certeza", "com", "positivo", "faz", "manda", "ver", "vai", "la", "por", "favor", "chefe", "beto", "ser", "cancelar", "apagar",
  "remarcar", "mudar", "marcar"]);
const STRONG_YES = new Set(["sim", "pode", "confirma", "confirmo", "confirmado", "claro", "isso", "ok", "beleza", "aham", "uhum", "fechado", "positivo", "faz", "manda", "vai"]);
const CONFIRM_QUESTION = /(cancel|apag|delet|remov|exclu|remarc|remarq|mov|alter|mud|troc|marc|marq|agend|cri|coloc|conflit|confirm|regist|lanc|anot|adicion)/;

export function userConfirmed(messages: ChatMsg[]): boolean {
  const last = lastUserText(messages);
  if (!last || last.index < 1) return false;
  const tokens = last.text.replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);
  if (tokens.length === 0 || tokens.length > 6) return false;
  if (!tokens.every((t) => CONFIRM_TOKENS.has(t)) || !tokens.some((t) => STRONG_YES.has(t))) return false;
  const prev = messages[last.index - 1];
  if (!prev || prev.role !== "assistant") return false;
  const sentences = norm(prev.content).split(/(?<=[.!?])\s+/).filter(Boolean);
  const question = sentences[sentences.length - 1] ?? "";
  // Pergunta de alternativa ("cancelo ou remarco?", "cancelo? Ou prefere mudar?"): um "sim" é ambíguo e não confirma nada.
  return question.endsWith("?") && CONFIRM_QUESTION.test(question) && !/\bou\b/.test(question);
}

/* ── My Hub e rede de proteção ───────────────────────────────────────────── */

const MONEY_VERB = /\b(gastei|paguei|comprei|recebi|ganhei|abasteci|almocei|jantei|depositei|transferi)\b/;
const MONEY_CUE = /(^|\s|r\$)\d|\b(reais|real|conto|pila|mil|centavos)\b/;   // número solto (45, 1.500), não dígito dentro de palavra
const QUESTION = /\b(quanto|quantos|quantas|qual|quais|como|onde|quando|por que|porque)\b/;
const ACTIVITY_VERB = /\b(bebi|treinei|estudei|meditei|dormi|corri|caminhei|malhei|pedalei|nadei)\b/;
const REGISTER_VERB = /\b(anota|anote|registra|registre|lanca|lance|adiciona|adicione|coloca|bota|marca|marque|cria|crie)\b/;
const REGISTER_NOUN = /\b(gasto|gastos|despesa|despesas|receita|receitas|transacao|tarefa|tarefas|habito|habitos|meta|metas|treino|estudo|projeto)\b/;

/** O chefe pediu para REGISTRAR algo no My Hub (gasto, receita, hábito, tarefa). Consulta ("quanto gastei?") não conta. */
export function wantsMyHubWrite(messages: ChatMsg[]): boolean {
  const last = lastUserText(messages);
  if (!last) return false;
  const t = last.text;
  // Pergunta é consulta ("quanto gastei em 2025?"), nunca registro. Só o "sim" a uma pergunta de valor (abaixo) escapa disso.
  const consulta = QUESTION.test(t) || t.trim().endsWith("?");
  if (!consulta) {
    if (MONEY_VERB.test(t) && MONEY_CUE.test(t)) return true;
    if (ACTIVITY_VERB.test(t)) return true;
    if (REGISTER_VERB.test(t) && REGISTER_NOUN.test(t)) return true;
    if (REGISTER_VERB.test(t) && MONEY_CUE.test(t) && !isCalendarTalk(t)) return true;
  }
  // O "sim" a uma pergunta de valor ("Registro uma despesa de R$ 1.500?") também libera o registro.
  const prev = messages[last.index - 1];
  return userConfirmed(messages) && !!prev && /(r\$|reais|valor|conto|pila)/.test(norm(prev.content));
}

/** "desfaz", "errei", "foi engano": desfazer o último registro do My Hub. */
export function wantsMyHubUndo(messages: ChatMsg[]): boolean {
  const last = lastUserText(messages);
  if (!last) return false;
  if (/\bnao\b/.test(last.text)) return false;
  return /\b(desfaz|desfaca|desfazer|desfiz|errei|foi engano|cancela (isso|esse|o ultimo)|apaga esse registro|volta atras)\b/.test(last.text);
}

/** O texto diz que JÁ fez algo (registrou, marcou, cancelou…). Se nenhuma ferramenta de escrita executou, é mentira. */
export function claimsWrite(text: string): boolean {
  return /\b(anotei|anotado|registrei|registrado|lancei|lancado|adicionei|adicionado|coloquei|marquei|criei|cancelei|remarquei|apaguei|desfiz)\b/.test(norm(text));
}
