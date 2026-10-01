import test from "node:test";
import assert from "node:assert/strict";
import { needsTools, userConfirmed, wantsCalendar, wantsCalendarWrite, wantsMyHubWrite, wantsMyHubUndo, claimsWrite } from "../lib/intent.ts";

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

/* ── My Hub ─────────────────────────────────────────────────────────────── */

test("wantsMyHubWrite: pedidos de registro de gasto, receita, hábito e tarefa", () => {
  for (const t of ["gastei 45 no mercado", "paguei 120 reais de luz", "recebi 2 mil de freelance", "comprei uma mochila por 300", "bebi 500 ml de água",
    "treinei hoje de manhã", "estudei 30 minutos de inglês", "anota que eu gastei 20 de uber", "cria uma tarefa para ligar pro contador",
    "adiciona um gasto de 50 na farmácia", "registra a receita de 1500 do cliente", "lança 80 de gasolina"]) {
    assert.equal(wantsMyHubWrite([u(t)]), true, t);
  }
});

test("wantsMyHubWrite: conversa e consulta não registram nada", () => {
  for (const t of ["quanto eu gastei esse mês", "como estão meus hábitos", "recebi uma ligação do João", "paguei caro nesse almoço mas valeu a pena",
    "me explica como funciona um orçamento", "qual meu saldo", "o que tenho de tarefas"]) {
    assert.equal(wantsMyHubWrite([u(t)]), false, t);
  }
});

test("wantsMyHubWrite: o 'sim' a uma pergunta de valor conta; a outra pergunta qualquer não", () => {
  assert.equal(wantsMyHubWrite([ask("Registro uma despesa de R$ 1.500,00 em Mercado?"), u("sim")]), true);
  assert.equal(wantsMyHubWrite([ask("Quer o briefing?"), u("sim")]), false);
  assert.equal(wantsMyHubWrite([ask("Cancelo a reunião com o João amanhã às 15h?"), u("sim")]), false);
});

test("wantsMyHubUndo: desfazer o último registro", () => {
  for (const t of ["desfaz", "desfaz isso por favor", "errei, desfaz o último"]) {
    assert.equal(wantsMyHubUndo([u(t)]), true, t);
  }
  for (const t of ["não desfaz nada", "como foi meu dia"]) {
    assert.equal(wantsMyHubUndo([u(t)]), false, t);
  }
});

test("claimsWrite: o texto diz que registrou/marcou/cancelou", () => {
  for (const t of ["Anotado, chefe.", "Registrei o gasto.", "Lancei no My Hub", "Marquei a reunião.", "Cancelei o almoço", "Criei o evento", "Adicionei na lista"]) {
    assert.equal(claimsWrite(t), true, t);
  }
  for (const t of ["Quer que eu anote?", "Não consegui registrar", "Posso marcar amanhã", "Vou verificar"]) {
    assert.equal(claimsWrite(t), false, t);
  }
});

test("registrar no My Hub e desfazer nunca vão pelo streaming de conversa", () => {
  for (const t of ["almocei por aqui hoje e gastei 35", "desfaz esse último registro por favor", "bebi bastante água hoje cedo"]) {
    assert.equal(needsTools([u(t)]), true, t);
  }
});

test("consulta com número ('quanto gastei em 2025?') NÃO é pedido de registro no My Hub", () => {
  for (const t of ["quanto gastei em 2025?", "quanto eu gastei em setembro de 2025", "qual o valor que gastei em 2024", "como estou gastando 50% da renda?",
    "quanto recebi de freelance em 2026", "onde eu paguei 300 reais mês passado?", "quanto eu gastei esse mês injetado2"]) {
    assert.equal(wantsMyHubWrite([u(t)]), false, t);
  }
  for (const t of ["gastei 45 no mercado", "paguei 300 reais de luz", "anota 20 de uber", "registra 1500 de freela", "gastei 45,50 no café"]) {
    assert.equal(wantsMyHubWrite([u(t)]), true, t);
  }
});

/* ── Revisão do My Hub (lote 2) ─────────────────────────────────────────── */

test("confirmar um registro alto também com 'pode registrar', 'pode anotar', 'pode lançar'", () => {
  const q = ask("Registro uma despesa de R$ 1.500,00 (Mercado da semana) em Mercado?");
  for (const t of ["sim, pode registrar", "pode anotar", "pode lançar", "pode registrar sim"]) {
    assert.equal(userConfirmed([q, u(t)]), true, t);
    assert.equal(wantsMyHubWrite([q, u(t)]), true, t);
  }
});

test("completar o dado que faltava: 'PJ', '45 reais', 'foi 45' depois de uma pergunta de registro", () => {
  for (const [q, r] of [["Qual conta: Carteira ou PJ?", "PJ"], ["Qual foi o valor?", "45 reais"], ["Em qual categoria você quer lançar?", "foi mercado"], ["Quanto foi?", "foi 45"]]) {
    assert.equal(wantsMyHubWrite([u("gastei no mercado hoje"), ask(q), u(r)]), true, `${q} -> ${r}`);
  }
  assert.equal(wantsMyHubWrite([ask("Quer o briefing do dia?"), u("PJ")]), false);
  assert.equal(wantsMyHubWrite([ask("Cancelo a reunião com o João amanhã às 15h?"), u("pode ser")]), false);
  assert.equal(wantsMyHubWrite([ask("Qual conta: Carteira ou PJ?"), u("então me explica como funciona o orçamento da empresa por favor")]), false, "resposta longa não é complemento");
});

test("'gastei 45 no mercado?' (a voz põe '?') ainda é registro; consulta de verdade não", () => {
  assert.equal(wantsMyHubWrite([u("gastei 45 no mercado?")]), true);
  for (const t of ["quero saber se gastei 200 no mercado", "será que gastei 200 no mercado", "me diz quanto gastei com 50 reais", "queria saber o que paguei 30 reais"]) {
    assert.equal(wantsMyHubWrite([u(t)]), false, t);
  }
});

test("falsos positivos de registro: dormir mal e música que 'custou' dinheiro", () => {
  for (const t of ["dormi mal hoje", "toca a música que eu paguei 10 reais", "coloca a playlist que eu comprei por 20 reais"]) {
    assert.equal(wantsMyHubWrite([u(t)]), false, t);
  }
});

test("wantsMyHubUndo mais preciso: sem 'cancela isso', 'volta atrás' soltos e sem 'errei' fora de contexto", () => {
  for (const t of ["cancela isso", "volta atrás", "errei o nome da playlist", "não desfaz nada", "como foi meu dia"]) {
    assert.equal(wantsMyHubUndo([u(t)]), false, t);
  }
  for (const t of ["desfaz", "desfaz o último registro", "desfaz esse gasto por favor", "apaga esse registro"]) {
    assert.equal(wantsMyHubUndo([u(t)]), true, t);
  }
  const claimed = ask("Anotei, chefe: Despesa de R$ 60,00 em Mercado.");
  assert.equal(wantsMyHubUndo([claimed, u("errei, era 45")]), true);
  assert.equal(wantsMyHubUndo([claimed, u("não, foi engano, era 45")]), true);
  assert.equal(wantsMyHubUndo([ask("Tudo certo por aqui."), u("errei, era 45")]), false);
});

test("claimsWrite entende negação, pergunta e fato anterior (sem empurrar o modelo a gravar sem dado)", () => {
  for (const t of ["Ainda não registrei nada.", "Não anotei porque falta o valor.", "Já está registrado.", "Quer que eu anote? Posso registrar agora.",
    "Não consegui marcar, chefe.", "Falta a conta para eu registrar."]) {
    assert.equal(claimsWrite(t), false, t);
  }
  for (const t of ["Anotei, chefe.", "Fechou. Registrei o gasto de R$ 45.", "Marquei a reunião e cancelei o almoço."]) {
    assert.equal(claimsWrite(t), true, t);
  }
});

/* ── Revisão do My Hub (lote 3) ─────────────────────────────────────────── */

test("'como', 'quando' e 'saber' no MEIO da frase não bloqueiam um registro legítimo", () => {
  for (const t of ["gastei 45 no mercado quando fui ontem", "paguei 300 de luz como combinado", "gastei 80 de gasolina quando abasteci"]) {
    assert.equal(wantsMyHubWrite([u(t)]), true, t);
  }
  for (const t of ["como estão meus gastos de 2025", "quando foi que gastei 300 de luz", "quanto gastei em março com 50 reais"]) {
    assert.equal(wantsMyHubWrite([u(t)]), false, t);
  }
});

test("negação antes do verbo: 'eu não gastei 45', 'não registra esse gasto de 45'", () => {
  for (const t of ["eu não gastei 45 no mercado", "não registra esse gasto de 45", "nunca paguei 300 de luz", "não anota esse gasto de 20"]) {
    assert.equal(wantsMyHubWrite([u(t)]), false, t);
  }
});

test("resposta curta que NÃO completa dado: negativa, ou pergunta que não é de registro", () => {
  assert.equal(wantsMyHubWrite([ask("Quer que eu registre?"), u("não")]), false);
  assert.equal(wantsMyHubWrite([ask("Registro a despesa de R$ 45,00?"), u("não quero")]), false);
  assert.equal(wantsMyHubWrite([ask("Quer que eu anote isso na sua memória?"), u("sim")]), false);
  assert.equal(wantsMyHubWrite([ask("Você tem saldo de R$ 300 na conta. Algo mais?"), u("o de 45")]), false);
  assert.equal(wantsMyHubWrite([ask("Qual conta: Carteira ou PJ?"), u("PJ")]), true);
});

test("desfazer: qualquer 'não' antes do verbo cancela ('não precisa desfazer', 'não quero desfazer nada')", () => {
  for (const t of ["não precisa desfazer", "não quero desfazer nada", "nao, deixa, não desfaz"]) {
    assert.equal(wantsMyHubUndo([u(t)]), false, t);
  }
  assert.equal(wantsMyHubUndo([u("desfaz o último")]), true);
});

test("claimsWrite: 'Sem problema, anotei' e 'Não consegui, mas registrei a ideia' SÃO afirmações; negação colada ao verbo não", () => {
  for (const t of ["Sem problema, anotei.", "Não consegui ver tudo, mas registrei a ideia.", "Beleza, marquei."]) {
    assert.equal(claimsWrite(t), true, t);
  }
  for (const t of ["Não anotei.", "Ainda não registrei nada.", "Não o anotei por falta de valor.", "Nunca marquei isso."]) {
    assert.equal(claimsWrite(t), false, t);
  }
});

/* ── Terceira revisão (roteamento) ──────────────────────────────────────── */

test("desfazer: 'não, desfaz isso' é desfazer; 'não precisa desfazer' não é", () => {
  for (const t of ["não, desfaz isso", "não sei o que houve, desfaz", "não, desfaz esse último"]) assert.equal(wantsMyHubUndo([u(t)]), true, t);
  for (const t of ["não precisa desfazer", "não quero desfazer", "nunca desfaz isso"]) assert.equal(wantsMyHubUndo([u(t)]), false, t);
});

test("negação é por ocorrência: 'não gastei 45, gastei 50' registra; 'não esquece de registrar' registra", () => {
  for (const t of ["eu não gastei 45, gastei 50 no mercado", "não esquece de registrar 50 de gasolina", "não deixa de anotar o gasto de 50"]) {
    assert.equal(wantsMyHubWrite([u(t)]), true, t);
  }
  for (const t of ["eu não gastei 45 no mercado", "não registra esse gasto de 45"]) assert.equal(wantsMyHubWrite([u(t)]), false, t);
});

test("'como sempre, gastei 80' é registro; resposta curta a pergunta de AGENDA não liga escrita no My Hub", () => {
  assert.equal(wantsMyHubWrite([u("como sempre, gastei 80 no mercado")]), true);
  assert.equal(wantsMyHubWrite([ask("Quer que eu anote a reunião na agenda?"), u("pode")]), false);
});
