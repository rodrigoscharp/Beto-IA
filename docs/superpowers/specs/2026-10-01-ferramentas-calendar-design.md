# Ferramentas nativas + Calendar completo — design

Data: 2026-10-01. Origem: brainstorm `docs/superpowers/brainstorms/2026-10-01-beto-features.md` (seção C) e pedido "começa pelas ferramentas nativas e o Calendar".

## Objetivo

Trocar o jeito frágil de agir (o modelo escreve `[CALENDAR:{…}]` no meio do texto e o navegador executa) por **chamada de ferramentas nativa** da Groq, e usar isso para dar ao Beto um Calendar de verdade: ver a agenda por período, criar com aviso de conflito, remarcar, cancelar com confirmação e achar horário livre. O Beto passa a agir em vários passos ("acha um horário livre amanhã e marca com o João") e responde com uma frase natural, em vez de um texto fixo.

## Escopo desta rodada

1. **Infraestrutura de ferramentas no servidor:** registro de ferramentas (nome, descrição, parâmetros em JSON Schema, execução), laço de chamadas de até 4 passos, tratamento de erro, token do Google vindo do cookie da sessão.
2. **Calendar nativo:** `list_events`, `find_free_slots`, `create_event`, `update_event`, `delete_event`.
3. **Roteamento:** as ferramentas do Calendar entram no prompt completo só quando o pedido parece de agenda (e sempre na escalada `[NEEDTOOLS]`). O bloco `[CALENDAR:…]` sai do prompt.

**Fica para as próximas rodadas** (mesma infraestrutura, migração uma a uma): Spotify, timer, Gmail, GitHub, memória, My Hub e briefing continuam pelas tags. Spotify e timer vivem no navegador (player e contagem na página), então pedem um desenho próprio de "ferramenta executada no cliente".

## Decisões

### Arquitetura
- Nova rota de laço dentro de `/api/chat` (modo completo, sem streaming). O caminho de streaming da conversa não muda.
- `lib/toolloop.ts` (puro): recebe uma função `complete(messages, tools)`, uma `execute(name, args)` e as mensagens; chama o modelo, executa as ferramentas pedidas, devolve os resultados ao modelo e repete até vir texto (máximo 4 passos; passou disso, devolve uma frase de desculpa curta). Testável com modelo e Calendar falsos.
- `lib/groq.ts` ganha `groqComplete` (mesma lista e troca de modelo, devolve conteúdo + `tool_calls`). Modelo que devolve chamada malformada (400) conta como falha e passa ao próximo.
- `lib/calendar.ts` (puro): datas em `America/Sao_Paulo`, normalização de evento, texto falado em pt-BR, sobreposição, horários livres.
- `lib/tools/calendar.ts`: definições das 5 ferramentas e a execução sobre uma interface `CalendarApi` (listar, buscar, inserir, alterar, apagar), implementada com `googleFetch`. A interface é o que os testes substituem.
- Token: `getGoogleToken(req)` (cookie da sessão), como o resto do app. Sem token, a ferramenta devolve `needsLogin`; a rota responde `{reply, needsGoogleLogin:true}` e o cliente vai para `/api/calendar/login` (o que já fazia).

### Ferramentas
| Ferramenta | Parâmetros | Observação |
|---|---|---|
| `list_events` | `start?`, `end?` (data `YYYY-MM-DD`), `query?`, `max?` | padrão: de hoje até 7 dias; devolve id, título, início, fim, local, nº de convidados e o texto falado |
| `find_free_slots` | `date` ou `start`+`end`, `duration_min`, `from_hour?`, `to_hour?` | só considera eventos que ocupam o horário; janela padrão 9h–18h; devolve até 5 janelas |
| `create_event` | `title`, `start` (`YYYY-MM-DDTHH:MM`), `end?`/`duration_min?`, `location?`, `description?`, `attendees?`, `ignore_conflicts?` | se houver conflito e `ignore_conflicts` não for verdadeiro, **não cria** e devolve os eventos em conflito; o modelo pergunta ao chefe |
| `update_event` | `event_id`, campos a mudar | mudar só o início mantém a duração; com convidados externos exige confirmação |
| `delete_event` | `event_id` | **sempre** exige confirmação |

### Confirmação (ruling meu: o usuário não respondeu a pergunta sobre o que pode fazer sozinho)
- Criar, ver e achar horário: o Beto faz na hora. Remarcar sem convidados: faz na hora (o chefe já disse a mudança). Cancelar, e remarcar evento com convidados: pede confirmação.
- A confirmação é **imposta no servidor**, não confiada ao modelo: `delete_event` (e `update_event` com convidados) só executa se a última fala do chefe for afirmativa ("sim", "pode", "confirma"…) **e** a fala anterior do Beto existir. Caso contrário devolve `needs_confirmation` com o resumo do evento e a instrução de perguntar. O histórico do navegador guarda só texto, então na confirmação o modelo busca o evento de novo antes de apagar.
- Convidados nunca são notificados em silêncio: alterações em evento com convidados usam a confirmação acima e `sendUpdates=all` só depois dela; criação com convidados exige que o chefe tenha pedido convidados.

### Datas
- O modelo recebe hoje (data, dia da semana, hora). Ele manda datas locais (`YYYY-MM-DDTHH:MM`); o servidor envia ao Google como `dateTime` + `timeZone: America/Sao_Paulo`, sem conta de deslocamento. Para comparar intervalos usa `-03:00` (São Paulo não tem horário de verão desde 2019; comentário no código).
- O parser antigo de "amanhã", "sexta" e "meio-dia" sai: o modelo resolve a data e a hora e a ferramenta valida o formato (erro claro de volta ao modelo se vier inválido).

### Voz
- Cada evento devolvido leva um campo `spoken` pronto ("quinta-feira, 2 de outubro, das 15h às 16h"), para o modelo não ler datas ISO. O prompt do Calendar manda responder curto, falado, sem listas e sem markdown (regra de voz já existente).

## Riscos e o que não dá para testar aqui

- O ambiente não tem chave da Groq nem acesso ao Google Calendar real. A validação usa uma Groq falsa que devolve `tool_calls` e um Calendar falso (mesma forma de resposta da API). **O comportamento de cada modelo real com chamada de ferramentas só aparece no primeiro uso em produção.** Mitigação: troca automática de modelo em qualquer erro, limite de 4 passos e mensagem de desculpa curta.
- `gpt-oss` já mostrou um 400 quando confunde texto com chamada de ferramenta; o laço trata como falha de modelo e tenta o próximo.
- Cancelar é irreversível: a regra do servidor (acima) é a barreira principal; o prompt é a segunda.

## Rulings

- Sem documento de plano separado (execução delegada); as tarefas seguem a ordem das decisões.
- Spotify e timer fora desta rodada por viverem no navegador.
