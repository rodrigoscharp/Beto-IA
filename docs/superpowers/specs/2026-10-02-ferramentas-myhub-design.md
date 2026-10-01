# My Hub por ferramentas nativas — design

Data: 2026-10-02. Continuação de `2026-10-01-ferramentas-calendar-design.md`: o Beto escolhe por onde migrar as outras integrações e começa pelo My Hub.

## Por que o My Hub primeiro

É a integração mais frágil e a de uso diário (gastos, hábitos, tarefas). Hoje o modelo escreve `[MYHUB:{…}]` no texto e o navegador executa. Disso nasceram quatro gambiarras: um retry do navegador para quando o modelo diz "anotei" sem a tag, uma segunda ida ao modelo só para explicar falhas (`askAboutFailure`), o "desfazer" guardado no estado do navegador e a regra "valor acima de mil reais pede confirmação", que é só texto no prompt. Com ferramentas nativas o servidor executa e devolve o resultado real, o modelo pergunta o que falta dentro do mesmo laço, e a confirmação vira regra do servidor.

## Decisões

### Infraestrutura (generalizada)
- A rota `/api/chat` passa a montar **conjuntos de ferramentas** por pedido: agenda e/ou My Hub. `replyWithCalendar` vira `replyWithTools`; a escalada `[NEEDTOOLS]` liga **todos** os conjuntos.
- O despacho é por nome: `my_hub_*` vai para `lib/tools/myhub.ts`; as ferramentas de agenda seguem em `lib/tools/calendar.ts`. Novos conjuntos (memória, Gmail, GitHub) entram do mesmo jeito nas próximas rodadas.
- A rede de proteção "disse que registrou/marcou sem chamar a ferramenta" **sai do navegador e vai para o servidor**: se o texto final diz que fez (`CLAIMS_WRITE`), o chefe pediu escrita e nenhuma ferramenta de escrita executou, o servidor refaz o laço uma vez com uma mensagem de sistema corretiva.

### Ferramentas do My Hub
| Ferramenta | Parâmetros | Observação |
|---|---|---|
| `my_hub_register` | `acao` (nome da ação do catálogo), `entrada` (objeto) | usa `myHubRegistrar` (já normaliza e o My Hub valida, resolve nomes e recusa o ambíguo); devolve `registered` com o resumo, ou `failed` com o motivo para o modelo perguntar o que falta |
| `my_hub_undo` | nenhum | desfaz o último registro (janela de 15 min), usando o caminho de desfazer que o navegador guarda e reenvia |

O catálogo de ações e os nomes que existem (contas, categorias, hábitos) continuam no prompt, vindos do My Hub (`beto-contexto`); só muda a instrução de **como** registrar (ferramenta, sem tag).

### Regras que o servidor impõe
- Escrita só com intenção do chefe (`wantsMyHubWrite`: gastei, recebi, anota, registra, bebi água, treinei, cria uma tarefa…) ou confirmação.
- **Valor acima de R$ 1.000** só registra com o "sim" do chefe (`userConfirmed`) a uma pergunta do Beto que **cita o valor**; antes disso a ferramenta devolve `needs_confirmation` com a frase pronta (`ask_with`: "Registro uma despesa de R$ 1.500,00 em Mercado?").
- No máximo **3 registros por mensagem** e **nenhum duplicado** (mesma ação e mesma entrada duas vezes) na mesma requisição.
- Desfazer só com pedido de desfazer ("desfaz", "errei", "foi engano") e com registro recente.

### Desfazer sem estado no servidor
O navegador continua guardando o último caminho de desfazer, agora recebido na resposta do servidor (`undo`), e o reenvia no corpo do pedido seguinte. É a mesma confiança de hoje (o navegador já mandava o caminho ao `/api/myhub/desfazer`).

### Limpeza do cliente
Saem do navegador: `execMyHub`, `askAboutFailure`, a leitura da tag `[MYHUB:…]`, o retry de "anotei sem tag" (agora no servidor), o hint de desfazer. Saem do servidor as rotas `/api/myhub/acao` e `/api/myhub/desfazer`, que ninguém mais chama.

## Fora de escopo e riscos
- Sem My Hub real aqui: a validação usa um My Hub falso (contexto, registrar, desfazer) e a Groq falsa. **O comportamento de cada modelo real com a ferramenta só aparece em produção.** O My Hub continua sendo quem valida e recusa o ambíguo.
- O catálogo de ações é texto livre vindo do My Hub; o servidor só exige que `acao` seja um identificador simples (letras) e deixa o My Hub recusar o que não conhece.
- Memória, Gmail e GitHub ficam para as próximas rodadas.
