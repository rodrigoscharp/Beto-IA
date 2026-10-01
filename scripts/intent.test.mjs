import test from "node:test";
import assert from "node:assert/strict";
import { needsTools, userConfirmed, wantsCalendar, wantsCalendarWrite } from "../lib/intent.ts";

const u = (content) => ({ role: "user", content });
const a = (content) => ({ role: "assistant", content });

test("conversa solta com 3+ palavras não precisa de ferramentas", () => {
  assert.equal(needsTools([u("como você está hoje de manhã")]), false);
  assert.equal(needsTools([u("me explica a diferença entre latência e vazão")]), false);
  assert.equal(needsTools([u("qual a sua opinião sobre começar com um mvp pequeno")]), false);
});

test("pedidos de cada integração pedem o prompt completo", () => {
  for (const t of [
    "toca uma música do Drake pra mim",
    "pausa a música agora por favor",
    "marca uma reunião com a Maria amanhã às 15h",
    "o que tenho na agenda de hoje",
    "tem algum PR aberto no repositório",
    "tem algum email importante hoje",
    "quanto tempo falta no timer",
    "me dá o resumo do dia",
    "lembra que eu acordo cedo sempre",
    "gastei 50 reais no mercado hoje",
    "eu treinei hoje de manhã cedo",
  ]) assert.equal(needsTools([u(t)]), true, t);
});

test("acento e maiúscula não enganam o roteador", () => {
  assert.equal(needsTools([u("TOCA ALGO DO QUEEN PRA MIM")]), true);
  assert.equal(needsTools([u("Qual é a minha AGENDA de amanhã")]), true);
  assert.equal(needsTools([u("me mostra os ÚLTIMOS COMMITS do projeto")]), true);
});

test("fala curta (menos de 3 palavras) vai completa: pode ser resposta a uma oferta", () => {
  assert.equal(needsTools([u("sim")]), true);
  assert.equal(needsTools([u("quero")]), true);
  assert.equal(needsTools([u("a segunda")]), true);
});

test("depois de uma pergunta do Beto, resposta curta vai completa; conversa longa não", () => {
  const offer = a("[emo:alegre] Bom dia, chefe! Quer que eu passe o briefing do dia?");
  assert.equal(needsTools([offer, u("pode ser sim")]), true);
  assert.equal(needsTools([offer, u("hoje o dia vai ser puxado com muita coisa para fechar")]), false);
});

test("mensagem de sistema (retry, falha do My Hub) vai completa", () => {
  assert.equal(needsTools([u("[SISTEMA] O registro no My Hub falhou: faltou o valor. Explique em uma frase.")]), true);
});

test("sem mensagens ou sem fala do usuário: completa (seguro)", () => {
  assert.equal(needsTools([]), true);
  assert.equal(needsTools([a("oi")]), true);
});

test("tag de emoção no histórico não atrapalha a leitura da fala anterior", () => {
  const prev = a("[emo:neutro] Fechou, chefe. Tudo certo por aqui.");
  assert.equal(needsTools([prev, u("então me conta mais sobre essa ideia de negócio")]), false);
});

test("registros e comandos disfarçados (achado da revisão) vão pelo prompt completo", () => {
  for (const t of [
    "almocei 35 reais hoje",
    "fui na academia hoje cedo",
    "corri cinco quilômetros hoje",
    "uber de 20 conto agora",
    "coloca aquela do Coldplay pra mim",
    "bota um rock aí pra mim",
    "me avisa daqui 20 min por favor",
    "como tá meu dia hoje então",
    "lê o da Maria pra mim",
    "abaixa um pouco aí por favor",
    "paguei a conta de luz ontem",
    "são 3 tarefas para amanhã",
  ]) assert.equal(needsTools([u(t)]), true, t);
});

test("conversa que parecia suspeita continua em modo conversa (streaming)", () => {
  for (const t of [
    "como você está hoje de manhã",
    "me explica a diferença entre latência e vazão",
    "tô bem e você como anda",
    "acho que vou mudar de estratégia no produto",
  ]) assert.equal(needsTools([u(t)]), false, t);
});

test("oferta do Beto com a pergunta no meio da fala: resposta afirmativa curta vai completa", () => {
  const offer = a("[emo:alegre] Quer o briefing? Posso te passar agora mesmo.");
  assert.equal(needsTools([offer, u("sim, pode mandar")]), true);
  assert.equal(needsTools([offer, u("quero ouvir sim")]), true);
});

test("pergunta qualquer do Beto seguida de resposta curta que não é sim/não continua em conversa", () => {
  const q = a("[emo:neutro] Tudo certo por aqui. E você, como tá?");
  assert.equal(needsTools([q, u("tô cansado mas indo bem")]), false);
});

const ask = (t) => a(`[emo:neutro] ${t}`);

test("userConfirmed: 'sim' depois de uma pergunta de cancelar/remarcar confirma", () => {
  const q = ask("Cancelo a reunião com o João amanhã às 15h?");
  for (const t of ["sim", "Sim.", "pode cancelar", "pode sim", "confirma", "isso mesmo", "claro", "beleza, pode"]) {
    assert.equal(userConfirmed([q, u(t)]), true, t);
  }
});

test("userConfirmed: negativa, pedido novo ou frase longa não confirmam", () => {
  const q = ask("Cancelo a reunião com o João amanhã às 15h?");
  for (const t of ["não", "não, deixa", "sim mas muda pra quinta", "cancela a reunião de amanhã", "apaga tudo", "sim eu quero que você cancele todas as reuniões da semana"]) {
    assert.equal(userConfirmed([q, u(t)]), false, t);
  }
});

test("userConfirmed: sem pergunta de confirmação antes, 'sim' não confirma nada", () => {
  assert.equal(userConfirmed([u("sim")]), false);
  assert.equal(userConfirmed([ask("E você, como tá?"), u("sim")]), false);
  assert.equal(userConfirmed([ask("Quer o briefing?"), u("sim")]), false);
  assert.equal(userConfirmed([ask("Cancelo a reunião."), u("sim")]), false, "sem pergunta");
  assert.equal(userConfirmed([]), false);
});

test("userConfirmed: usa a ÚLTIMA fala do usuário e a fala do Beto logo antes dela", () => {
  const q = ask("Posso remarcar o almoço para quinta às 12h?");
  assert.equal(userConfirmed([u("remarca o almoço"), q, u("pode")]), true);
  assert.equal(userConfirmed([q, u("pode"), ask("Pronto, remarquei."), u("valeu")]), false);
});

test("wantsCalendar: pedidos de agenda sim, conversa comum não", () => {
  for (const t of ["o que tenho na agenda amanhã", "marca uma reunião com a Maria sexta às 15h", "cancela minha reunião de hoje",
    "remarca o almoço pra quinta", "acha um horário livre amanhã", "tenho algum compromisso na segunda", "qual meu próximo evento",
    "estou livre na terça à tarde", "agenda um café com o João"]) {
    assert.equal(wantsCalendar([u(t)]), true, t);
  }
  for (const t of ["como você está hoje", "me explica o que é latência", "toca uma música do Queen"]) {
    assert.equal(wantsCalendar([u(t)]), false, t);
  }
});

test("wantsCalendar: resposta curta a uma pergunta de agenda do Beto continua no Calendar", () => {
  assert.equal(wantsCalendar([ask("Cancelo a reunião com o João amanhã às 15h?"), u("sim")]), true);
  assert.equal(wantsCalendar([ask("Tem conflito com o almoço. Marco mesmo assim?"), u("pode marcar")]), true);
  assert.equal(wantsCalendar([ask("E você, como tá?"), u("sim")]), false);
});

test("pedidos de agenda nunca vão pelo streaming de conversa (needsTools)", () => {
  for (const t of ["estou livre amanhã à tarde por acaso", "tenho algum compromisso na segunda de manhã", "qual meu próximo evento marcado"]) {
    assert.equal(needsTools([u(t)]), true, t);
  }
  assert.equal(needsTools([ask("Cancelo a reunião com o João amanhã às 15h?"), u("pode sim")]), true);
});

/* ── Achados da revisão das ferramentas ─────────────────────────────────── */

test("confirmação só vale como afirmativa PURA: 'sim' + nova ordem não confirma", () => {
  const q = ask("Cancelo a reunião com o João amanhã às 15h?");
  for (const t of ["pode apagar todas de amanhã", "sim, apaga todas de amanhã", "sim e cancela a do Pedro também", "pode cancelar tudo", "claro, e remarca a outra"]) {
    assert.equal(userConfirmed([q, u(t)]), false, t);
  }
  for (const t of ["sim", "Sim, pode", "pode cancelar", "pode sim", "confirma", "isso mesmo", "beleza pode", "claro chefe", "fechado"]) {
    assert.equal(userConfirmed([q, u(t)]), true, t);
  }
});

test("confirmação: a PERGUNTA tem de ser a última frase do Beto e ser sobre cancelar/remarcar/marcar", () => {
  assert.equal(userConfirmed([ask("Pronto, mudei o título. Quer mais algo?"), u("sim")]), false);
  assert.equal(userConfirmed([ask("Cancelo a reunião com o João amanhã. Quer mais algo?"), u("sim")]), false);
  assert.equal(userConfirmed([ask("Tem conflito com o Almoço. Marco mesmo assim?"), u("pode")]), true);
  assert.equal(userConfirmed([ask("Cancelo a reunião com o João amanhã às 15h?"), u("sim")]), true);
});

test("wantsCalendar: falsos positivos do dia a dia não entram no Calendar", () => {
  for (const t of ["qual a melhor marca de tênis", "o Marcos ligou ontem", "em março eu viajo para a praia", "tenho algum email novo hoje",
    "software livre é bom para empresa", "o que eu como no almoço hoje", "como marcar presença numa planilha do excel"]) {
    assert.equal(wantsCalendar([u(t)]), false, t);
  }
});

test("wantsCalendar: pedidos reais continuam, inclusive verbos de mover e eventos sem a palavra agenda", () => {
  for (const t of ["marca uma reunião amanhã às 15h", "marque o dentista para sexta", "remarca a call de hoje", "desmarca o almoço de amanhã",
    "joga a call do João pra amanhã", "muda a consulta para sexta de manhã", "adia a reunião para a semana que vem",
    "estou livre amanhã à tarde", "o que tenho amanhã", "tenho algum compromisso na segunda", "qual meu próximo evento",
    "acha um horário livre na quinta", "agenda um café com a Ana sexta"]) {
    assert.equal(wantsCalendar([u(t)]), true, t);
  }
});

test("wantsCalendarWrite: só liberar escrita quando o chefe pediu para criar/mudar/cancelar", () => {
  for (const t of ["marca uma reunião amanhã", "remarca a call pra sexta", "cancela o almoço", "joga isso pra quinta", "cria um evento hoje", "adia a reunião"]) {
    assert.equal(wantsCalendarWrite([u(t)]), true, t);
  }
  for (const t of ["o que tenho amanhã", "tenho algum compromisso na segunda", "estou livre quinta", "qual meu próximo evento", "me lê a agenda de hoje"]) {
    assert.equal(wantsCalendarWrite([u(t)]), false, t);
  }
  assert.equal(wantsCalendarWrite([ask("Cancelo a reunião com o João amanhã às 15h?"), u("sim")]), true, "confirmação conta");
  assert.equal(wantsCalendarWrite([ask("E você, como tá?"), u("sim")]), false);
});

/* ── Segunda revisão ────────────────────────────────────────────────────── */

test("confirmação vale também para perguntas de marcar, agendar, criar, colocar e deletar", () => {
  for (const q of ["Quer que eu marque a reunião amanhã às 15h?", "Posso agendar o dentista sexta às 10h?", "Crio o evento amanhã às 9h?",
    "Coloco na agenda?", "Tem conflito com o Almoço. Quer que eu marque mesmo assim?", "Deleto o evento Almoço de amanhã?", "Quer que eu remarque a call para sexta?"]) {
    assert.equal(userConfirmed([ask(q), u("sim")]), true, q);
    assert.equal(wantsCalendarWrite([ask(q), u("sim")]), true, q);
  }
});

test("pergunta de alternativa ('X? Ou prefere Y?') não é confirmação de nada", () => {
  assert.equal(userConfirmed([ask("Cancelo a reunião com o João? Ou prefere mudar o horário?"), u("sim")]), false);
  assert.equal(userConfirmed([ask("Cancelo ou remarco a reunião do João amanhã às 15h?"), u("sim")]), false);
});

test("criar, apagar e renomear evento também são pedidos de agenda (sem depender do [NEEDTOOLS])", () => {
  for (const t of ["cria um evento amanhã às 15h", "bota uma call amanhã às 9", "adiciona reunião com João sexta", "apaga o evento das 15h",
    "exclui o compromisso de hoje", "renomeia a reunião de amanhã", "coloca um almoço com a Ana na quinta"]) {
    assert.equal(wantsCalendar([u(t)]), true, t);
    assert.equal(wantsCalendarWrite([u(t)]), true, t);
  }
  for (const t of ["coloca uma música do Queen", "cria uma função em typescript", "apaga o histórico da conversa", "bota fé que vai dar certo"]) {
    assert.equal(wantsCalendar([u(t)]), false, t);
  }
});
