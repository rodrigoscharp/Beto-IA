import test from "node:test";
import assert from "node:assert/strict";
import { needsTools } from "../lib/intent.ts";

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
