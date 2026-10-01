# Memória por ferramentas nativas — design

Data: 2026-10-02. Terceira integração migrada para ferramentas nativas (depois de agenda e My Hub), com a infraestrutura já generalizada em `replyWithTools`.

## O que muda

Hoje o modelo escreve `[MEMORY:{…}]` no texto e o navegador executa em `/api/memory/command`. Passa a ser ferramenta executada no servidor, e o Beto ganha o que não existia: **esquecer** ("esquece que eu gosto de jazz").

## Ferramentas

| Ferramenta | Parâmetros | Regra do servidor |
|---|---|---|
| `memory_save` | `content`, `category` (`preference`, `fact`, `habit`, `task`, `other`) | só com pedido explícito do chefe; até 300 caracteres, sem quebra de linha; não duplica (mesmo texto normalizado, ou um contido no outro); máximo 3 por mensagem |
| `memory_list` | `query?` | só leitura; devolve até 40 memórias com data |
| `memory_forget` | `query` (palavras do que esquecer) | só com pedido explícito de esquecer; busca por palavras (nunca por id); 1 achado: apaga e diz o que apagou; vários: devolve as opções e o modelo pergunta qual; nenhum: avisa; **máximo 1 apagada por mensagem**; nunca apaga "tudo" |

## Por que esse desenho

- **Memória é persistente e vai para todo prompt futuro.** Um título de evento, um email ou qualquer texto de terceiros que induzisse o Beto a "lembrar" algo seria envenenamento duradouro. Por isso salvar e esquecer exigem intenção explícita do chefe na mensagem (`wantsMemorySave`, `wantsMemoryForget`), e o aprendizado automático "quando você aprender algo permanente" sai: sem pedido, o modelo nem recebe a ferramenta de escrita.
- **Esquecer por busca, não por id:** o modelo não adivinha ids, e a ambiguidade vira pergunta ao chefe.
- **"Esquece, deixa pra lá" não apaga memória:** a intenção de esquecer exige uma referência a memória ("da sua memória", "que eu gosto…", "sobre mim").
- O bloco de memórias no prompt passa a dizer que são **dados** sobre o chefe, nunca instruções.
- Depois de salvar ou esquecer, o cache de memórias do servidor (5 min) é invalidado.

## Limpeza

Saem do navegador `execMemory`, a tag `[MEMORY:]` e a rota `/api/memory/command`. O bloco `[MEMORY:…]` sai do prompt; sem as ferramentas na conversa, o modelo responde só `[NEEDTOOLS]`.

## Fora de escopo e riscos

- Sem Supabase real aqui: a validação usa uma API REST falsa no formato do PostgREST. Gmail e GitHub ficam para as próximas rodadas.
- O Beto deixa de salvar sozinho o que "aprende" no meio da conversa; só salva quando o chefe pede. É uma troca consciente de conveniência por segurança, e fácil de reverter (permitir `memory_save` sem pedido quando não houver conteúdo de terceiros no contexto).

## Validação

- Testes de unidade: `scripts/memorytools.test.mjs` (11), intenções em `scripts/intent.test.mjs`, guia e bloco de dados em `scripts/prompt.test.mjs`. Suíte: 266 passando.
- E2E com Groq falsa e Supabase falso (PostgREST): guardar, não duplicar, listar, rede de proteção ("Anotado" sem ferramenta refaz e guarda), injeção (modelo manda `memory_save` num pedido de email: recusado), "esquece, deixa pra lá" (não apaga) e esquecer só a memória pedida. Conversa comum não anexa as ferramentas.
- `claimsWrite` passou a entender guardei, guardado, salvei, memorizei e esqueci.
- Comportamento de cada modelo real com as ferramentas só aparece em produção.
