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

## Correções depois da revisão independente

- **Origem do conteúdo:** `memory_save` só vale se metade das palavras de peso do conteúdo aparece na fala do chefe (`userText`, com tolerância de "gosto/gosta"); `memory_forget` exige todas as palavras da busca na fala dele. Um título de evento ou email copiado pelo modelo não vira memória, mesmo quando o pedido do chefe abriu o portão ("vê minha agenda e lembra que…"). Resta o caso de o chefe colar texto de terceiros na própria fala e pedir para lembrar: aí o pedido é dele.
- **Intenção:** negação e "parar de lembrar" nunca ligam salvar; pergunta ("você lembra que…?"), compromisso ("preciso lembrar que amanhã…") e arquivo ("salva no drive") também não. "grava que", "toma nota", "apaga a memória do jazz", "esquece que eu tenho cachorro" e "quais coisas você lembra" passam a valer.
- **Resposta curta:** "a do jazz" após "qual você quer que eu esqueça?" e "sim" após "quer que eu guarde…?" valem como intenção e levam a pergunta do Beto como base de origem.
- **Tema largo só para anexar** as ferramentas; quem executa continua o portão estrito. Se disser que guardou sem intenção executável, o servidor troca por uma frase honesta.
- **Rede de proteção sem falso positivo:** `claimsWrite` perdeu "guardado" e "esqueci"/"salvei" soltos ("o segredo ficou guardado", "salvei a pátria") e ignora "já tá guardado". O navegador só refaz com o prompt completo se o chefe pediu escrita. O desfazer do My Hub ignora fala anterior sobre memória.
- **Banco:** erro do Supabase vira `failed` (não "nada guardado" nem `not_found`) e não é cacheado; `deleteMemory` confere que apagou uma linha; o cache tem contador de geração contra busca em voo que repõe dado velho.
- **Dedup:** igualdade ou contenção em limite de palavra com diferença de até 2 palavras ("usa Mac" não bloqueia "usa Macbook Pro com Linux"). Busca de esquecer aceita plural e recusa "tudo" e o nome do chefe.
- **Deferido (Minor):** o cache é por instância serverless (outras instâncias podem mostrar a memória esquecida por até 5 minutos); janela de 200 memórias na busca.
