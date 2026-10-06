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

/* "o que tem pra hoje", "o que falta fazer hoje", "programação de hoje": pergunta sobre o dia dele. No modo conversa
   o Beto não tem dado nenhum e acaba inventando tarefa e reunião; isso precisa sempre dos dados reais. */
const DAY_PLAN = /\b(?:o que|oq|quais?|qual)\b.*\bhoje\b|\bfazer hoje\b|\bpra hoje\b|\bpara hoje\b|\bde hoje\b.*\b(?:programacao|planos?|pauta|pendencias?)\b|\b(?:programacao|planos?|pauta|pendencias?)\b.*\bhoje\b/;

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
  if (DAY_PLAN.test(text)) return true;
  if (wantsContent(messages)) return true;     // roteiro e plano de conteúdo: ferramenta, nunca chute         // o que fazer hoje: dados reais, nunca chute
  if (wantsCalendar(messages)) return true;     // agenda: ferramentas, nunca o streaming de conversa
  if (wantsMyHubWrite(messages) || wantsMyHubUndo(messages)) return true;   // registrar no My Hub: ferramentas
  if (wantsMemory(messages)) return true;                                    // lembrar, esquecer, listar memórias: ferramentas
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
  "remarcar", "mudar", "marcar", "registrar", "registra", "anotar", "anota", "lancar", "lanca"]);
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
/* Pergunta de verdade: palavra interrogativa NO COMEÇO ("quanto gastei…", "como estão meus gastos…") ou um pedido de informação.
   "gastei 45 quando fui ontem" e "paguei a luz como combinado" são registros: a palavra no meio da frase não conta. */
const QUESTION_START = /^(quanto|quantos|quantas|qual|quais|onde|quando|por que|porque|como(?! sempre| de costume| combinado))\b/;
const QUESTION_ANY = /\b(quero saber|queria saber|saber se|sera que|me diz|me fala|me conta)\b/;
/** O verbo aparece AFIRMADO em alguma ocorrência? Negação ('não gastei', 'não registra', 'nunca paguei') até 2 palavras antes anula só aquela ocorrência; 'não esquece de registrar' é afirmação. */
function affirmed(t: string, verb: RegExp): boolean {
  const g = new RegExp(verb.source, "g");
  let m: RegExpExecArray | null;
  while ((m = g.exec(t))) {
    const before = t.slice(0, m.index);
    const neg = /\b(nao|nunca|jamais)\s+(?:\w+\s+){0,2}$/.test(before) && !/\b(nao|nunca)\s+(esquece|esqueca|deixa|deixe)\s+de\s+$/.test(before);
    if (!neg) return true;   // basta UMA ocorrência não negada ("não gastei 45, gastei 50")
  }
  return false;
}const ACTIVITY_VERB = /\b(bebi|treinei|estudei|meditei|corri|caminhei|malhei|pedalei|nadei)\b/;
const MUSIC = /\b(toca|tocar|toque|musica|spotify|playlist|album)\b/;
const REGISTER_VERB = /\b(anota|anote|anotar|registra|registre|registrar|lanca|lance|lancar|adiciona|adicione|adicionar|coloca|bota|marca|marque|cria|crie|criar)\b/;
const REGISTER_NOUN = /\b(gasto|gastos|despesa|despesas|receita|receitas|transacao|tarefa|tarefas|habito|habitos|meta|metas|treino|estudo|projeto)\b/;

/** O chefe pediu para REGISTRAR algo no My Hub (gasto, receita, hábito, tarefa). Consulta ("quanto gastei?") não conta. */
export function wantsMyHubWrite(messages: ChatMsg[]): boolean {
  const last = lastUserText(messages);
  if (!last) return false;
  const t = last.text;
  // Pergunta é consulta ("quanto gastei em 2025?"), nunca registro. (O "?" sozinho não decide: a voz põe "?" em tudo.)
  const consulta = QUESTION_START.test(t.trim()) || QUESTION_ANY.test(t);
  if (!consulta && !MUSIC.test(t)) {
    if (MONEY_CUE.test(t) && affirmed(t, MONEY_VERB)) return true;
    if (affirmed(t, ACTIVITY_VERB)) return true;
    if (REGISTER_NOUN.test(t) && affirmed(t, REGISTER_VERB)) return true;
    if (MONEY_CUE.test(t) && !isCalendarTalk(t) && affirmed(t, REGISTER_VERB)) return true;
  }
  const prev = messages[last.index - 1];
  if (prev && prev.role === "assistant") {
    const p = norm(prev.content);
    // Resposta curta a uma pergunta de registro do Beto ("Qual conta?" -> "PJ"): completa o dado que faltava.
    const lastSentence = p.split(/(?<=[.!?])\s+/).filter(Boolean).pop() ?? "";
    if (words(t) <= 6 && lastSentence.endsWith("?")
        && /(qual conta|em qual conta|qual categoria|em qual categoria|qual (o )?valor|qual foi o valor|quanto foi|registr|anot|lanc)/.test(lastSentence)
        && !/(memoria|lembrar)/.test(lastSentence) && !CALENDAR_QUESTION.test(lastSentence)
        && !/^(nao|negativo|deixa|esquece|cancela|melhor nao)\b/.test(t)) return true;
    // O "sim" a uma pergunta de valor ("Registro uma despesa de R$ 1.500?") também libera o registro.
    if (userConfirmed(messages) && /(r\$|reais|valor|conto|pila)/.test(p)) return true;
  }
  return false;
}

/** "desfaz": desfazer o último registro do My Hub. "errei"/"foi engano" só contam logo depois de o Beto dizer que registrou. */
export function wantsMyHubUndo(messages: ChatMsg[]): boolean {
  const last = lastUserText(messages);
  if (!last) return false;
  const t = last.text;
  if (/\b(nao|nunca)\s+(precisa\s+|quero\s+|vou\s+)?(desfaz|desfaca|desfazer)\b/.test(t)) return false;   // 'não, desfaz isso' (vírgula) é desfazer
  if (/\b(desfaz|desfaca|desfazer|desfiz)\b/.test(t)) return true;
  if (/\bapaga (esse|o ultimo) (registro|gasto|lancamento)\b/.test(t)) return true;
  const prev = messages[last.index - 1];
  return !!prev && prev.role === "assistant" && claimsWrite(prev.content) && !/\b(guardei|memoriz\w*|esqueci|salvei|memoria)\b/.test(norm(prev.content))
    && /\b(errei|foi engano|engano meu|era outro valor|valor errado|nao era isso)\b/.test(t);
}

/** O texto diz que JÁ fez algo (registrou, marcou, cancelou…). Se nenhuma ferramenta de escrita executou, é mentira.
    Frase com negação ("não registrei"), pergunta ("quer que eu anote?") ou fato anterior ("já está registrado") não conta. */
const CLAIM = /\b(anotei|anotado|registrei|registrado|lancei|lancado|adicionei|adicionado|coloquei|marquei|criei|cancelei|remarquei|apaguei|desfiz|guardei|memorizei)\b|\b(salvei|esqueci) (isso|essa|esse|na memoria|que)\b/;
export function claimsWrite(text: string): boolean {
  for (const sentence of norm(text).split(/(?<=[.!?])\s+/)) {
    const m = CLAIM.exec(sentence);
    if (!m || sentence.trim().endsWith("?")) continue;
    if (/\b(nao|nunca|jamais)\s+(?:(?:o|a|os|as|ainda)\s+)?$/.test(sentence.slice(0, m.index))) continue;   // "não anotei", "ainda não registrei"
    if (/\bja (esta|estava|foi|ficou|ta|tinha)\b|\bja (anotei|registrei|guardei|salvei|memorizei)\b/.test(sentence)) continue;
    return true;
  }
  return false;
}

/* ── Memória ─────────────────────────────────────────────────────────────── */

/* A memória é persistente e entra em todo prompt futuro: salvar e esquecer só com pedido EXPLÍCITO do chefe nesta
   mensagem (um texto de terceiros nunca pode induzir isso). "me lembra de…" é lembrete, não memória. */
const REMIND_ME = /\bme (lembra|lembre)\b/;
const SAVE_STRONG = /\b(lembra|lembre|lembrar|guarda|guarde|guardar|memoriza|memorize|memorizar|grava|grave|gravar)\s+(que|isso|disso|ai)\b|\b(toma|tome|tomar) nota\b/;
const SAVE_WEAK = /\b(anota|anote|anotar|salva|salve|salvar)\s+(que|isso|disso)\b/;
const SAVE_OTHER = /\b(nao (esquece|esqueca) que|fica sabendo que|fique sabendo que|saiba que|so pra voce saber|so para voce saber|pode lembrar que|quero que voce lembre)\b/;
const NOT_MEMORY_SAVE = /\b(para|pare) de lembrar\b|\bnao precisa (mais )?(lembrar|guardar|salvar|anotar)\b|\bnao (guarda|guarde|salva|salve|anota|anote|lembra|lembre|memoriza|memorize|grava|grave)\b|\b(voce|vc) (lembra|lembrou) (que|de)\b|\b(preciso|tenho que|devo|vou|temos que) lembrar\b|\b(no|na|em|pro|pra|para o|para a) (drive|pasta|arquivo|computador|nuvem|dropbox|pen ?drive|celular)\b/;

/** Pergunta do Beto sobre guardar ("quer que eu guarde…?") ou sobre qual esquecer ("qual você quer que eu esqueça?"). */
function prevMemoryAsk(messages: ChatMsg[], index: number): "save" | "forget" | null {
  const prev = messages[index - 1];
  if (!prev || prev.role !== "assistant") return null;
  const t = norm(prev.content);
  if (/\bquer que eu (guarde|lembre|memorize|salve|grave)\b/.test(t)) return "save";
  if (/\bqual\b[^.!?]*\besquec|\bquer que eu esquec|\bquer que eu apague\b|\bqual (delas|dessas)\b/.test(t)) return "forget";
  return null;
}
const SHORT_NO = /^(nao|negativo|deixa|deixa quieto|esquece)\b/;

export function wantsMemorySave(messages: ChatMsg[]): boolean {
  const last = lastUserText(messages);
  if (!last) return false;
  const t = last.text;
  if (prevMemoryAsk(messages, last.index) === "save") return words(t) <= 6 && /^(sim|pode|quero|claro|aham|uhum|manda|isso|ok|beleza|por favor)\b/.test(t) && !SHORT_NO.test(t);
  if (REMIND_ME.test(t) || NOT_MEMORY_SAVE.test(t) || wantsMyHubWrite(messages)) return false;
  if (SAVE_STRONG.test(t) || SAVE_OTHER.test(t)) return true;
  return SAVE_WEAK.test(t) && !isCalendarTalk(t) && !(HAS_DAY_TIME.test(t) && HAS_CAL_NOUN.test(t));
}

const FORGET_VERB = "(?:esquece|esqueca|esquecer|apaga|apague|remove|remova|tira|tire)";
const MEMORY_REF = "(?:(?:da|a|essa) (?:sua )?memoria|sobre mim|que eu (?:gosto|moro|trabalho|acordo|uso|prefiro|odeio|curto|tenho)|o que eu (?:te )?(?:falei|disse|contei))";
const FORGET = new RegExp(`\\b${FORGET_VERB}\\b[^.!?]*?\\b${MEMORY_REF}|\\b(?:para|pare) de lembrar\\b|\\bnao precisa mais lembrar\\b|\\bpode esquecer (?:que|isso|disso)\\b|\\besquec(?:e|er) (?:que|o|a|os|as) \\w+`);
const LET_IT_GO = /\bdeixa (pra|para) la\b|\bdeixa quieto\b|\besquece isso ai\b|\bnao importa\b/;

/** Esquecer algo que o Beto guardou: precisa de referência explícita ("esquece, deixa pra lá" não conta). */
export function wantsMemoryForget(messages: ChatMsg[]): boolean {
  const last = lastUserText(messages);
  if (!last) return false;
  const t = last.text;
  if (prevMemoryAsk(messages, last.index) === "forget") return words(t) <= 6 && !SHORT_NO.test(t) && !LET_IT_GO.test(t);
  if (LET_IT_GO.test(t) || isCalendarTalk(t) || /\b(evento|reuniao|compromisso)\b/.test(t)) return false;
  return FORGET.test(t);
}

const MEMORY_LIST = /\bo que (voce|vc) (sabe|lembra|guardou|tem guardado) (sobre |de )?mim\b|\bquais (sao as |as )?(suas )?memorias\b|\bmostra (as |suas )?(suas )?memorias\b|\bquais coisas (voce|vc) (lembra|sabe)\b/;

export function wantsMemoryList(messages: ChatMsg[]): boolean {
  const last = lastUserText(messages);
  return !!last && MEMORY_LIST.test(last.text);
}

/** Tema de memória, largo: só decide ANEXAR as ferramentas (quem executa é o portão estrito acima). */
const MEMORY_TOPIC = /\b(lembr\w*|memoria\w*|guard\w*|grav[ae]\w*|toma\w* nota|anot\w*|esquec\w*|apag\w*)\b/;
export function wantsMemoryTopic(messages: ChatMsg[]): boolean {
  const last = lastUserText(messages);
  return !!last && MEMORY_TOPIC.test(last.text) && !isCalendarTalk(last.text);
}

/** O que o CHEFE disse e a que o conteúdo salvo ou a busca de esquecer podem se referir: a última fala dele e, numa
    resposta curta a uma pergunta do Beto sobre guardar/esquecer, também a pergunta do Beto. */
export function memoryGroundText(messages: ChatMsg[]): string {
  const last = lastUserText(messages);
  if (!last) return "";
  const ask = prevMemoryAsk(messages, last.index);
  return ask ? `${norm(messages[last.index - 1].content)} ${last.text}` : last.text;
}

/* Conteúdo: vídeo, episódio, roteiro, post. Liga a ferramenta que busca o roteiro no plano de conteúdo do My Hub. */
const CONTENT_TOPIC = /\b(videos?|episodios?|ep\.? ?\d+|eps?|grav\w*|roteiros?|conteudos?|posts?|postar|posto|reels?|stories|saga|legenda\w*|instagram|insta|youtube|tiktok|linkedin|pautas?)\b/;
export function wantsContent(messages: ChatMsg[]): boolean {
  const last = lastUserText(messages);
  return !!last && CONTENT_TOPIC.test(last.text) && !isCalendarTalk(last.text);
}

export function wantsMemory(messages: ChatMsg[]): boolean {
  return wantsMemorySave(messages) || wantsMemoryForget(messages) || wantsMemoryList(messages);
}
