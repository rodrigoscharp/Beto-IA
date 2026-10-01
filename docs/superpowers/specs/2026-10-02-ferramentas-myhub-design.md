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

## Correções depois da revisão independente

- **Valor lido de forma estrita:** o campo de valor (`valorEmReais`, `valor`, `quantia`, `amount`, `total`, `valorEmCentavos`…) só vale em formatos sem ambiguidade ("1.500", "1.500,50", "45,5", "45.5", "R$ 30"). "mil e quinhentos", "2 mil", "1k", "1e4", "1,500", negativo, zero, NaN e Infinity são **recusados** com a instrução de mandar número; nada disso chega cru ao My Hub.
- **O My Hub recebe o número já interpretado** ("1.500" vira 1500 em `valorEmReais`), nunca o texto que ele poderia ler diferente (antes, "1.500" confirmado podia gravar R$ 1,50).
- **A trava de R$ 1.000 vale para qualquer ação e qualquer campo de valor** (maiúsculas diferentes, `pagarFatura`, aporte, centavos), não só `registrarTransacao`.
- **O "sim" vale para o registro perguntado:** a última frase do Beto precisa citar o valor, o tipo (despesa ou receita), a categoria e a descrição que serão gravados; e só **um** registro alto por mensagem. A frase pronta (`ask_with`) não leva "?" nem "ou" da descrição, e o prompt manda usar algarismos nela.
- **Desfazer:** na mesma mensagem, desfaz o registro que acabou de ser feito (não o antigo do navegador). "errei" e "foi engano" só contam logo depois de o Beto dizer que registrou; "cancela isso" e "volta atrás" soltos saíram.
- **My Hub que demora:** se a resposta não chega (ele pode ter gravado), o registro vira `uncertain`, conta como feito, não é repetido e o Beto manda conferir no My Hub.
- **Rede de proteção:** `claimsWrite` entende negação ("não registrei"), pergunta e fato anterior ("já está registrado"); não refaz quando o My Hub ficou incerto.
- **Roteamento:** "gastei 45 no mercado?" (a voz põe "?") é registro; "quero saber se gastei…" e "toca a música que paguei 10 reais" não; resposta curta a uma pergunta de registro ("PJ", "foi 45") completa o dado que faltava; confirmar também com "pode registrar", "pode anotar", "pode lançar".
- `[NEEDTOOLS]` dentro do laço liga todos os conjuntos de ferramentas; o caminho de desfazer vindo do navegador é validado (só ASCII visível, até 300 caracteres).

## Segunda rodada de correções (mudança de estratégia na trava de valor)

A segunda revisão mostrou que adivinhar quais chaves "parecem dinheiro" num catálogo de texto livre é uma corrida perdida. A trava mudou de estratégia:

- **Varredura da entrada inteira**, em qualquer profundidade e dentro de arrays. Todo campo cuja chave parece valor (`valor`, `preco`, `total`, `custo`, `parcela`, `aporte`, `centavos`…, em qualquer caixa) é lido de forma estrita e normalizado **na mesma chave** como número (2 casas; centavos inteiros). Todo outro número acima de R$ 1.000 é tratado como dinheiro, **exceto** os campos seguros conhecidos (`quantidade`, `minutos`, `peso`, `calorias`, `parcelas`…).
- **Campos de valor conflitantes** (números diferentes) são recusados; valor absurdo (acima de R$ 10 milhões) também. `NaN` e `Infinity` não escapam (cópia por `structuredClone`, não por JSON).
- **O tipo vale o que o My Hub vai gravar:** a entrada passa pela mesma normalização do My Hub antes da trava ("credito" vira receita); em valor alto o tipo precisa ser despesa ou receita.
- **O "sim" vale para a frase exata:** o servidor gera a frase (ação, valor, tipo, descrição, categoria, conta e data) e a última frase do Beto precisa **terminar** nela (pode ter palavras antes, "Chefe, registro…", nunca detalhe a mais depois). Descrição com "." ou "?" é limpa para não quebrar a frase.
- **Anti-duplicata sobre a entrada normalizada**; depois de um registro **incerto** (timeout, HTTP 5xx ou 408), nenhum outro registro na mesma mensagem.
- **Desfazer** duas vezes na mesma mensagem não cai no registro antigo do navegador.
- **Registro alto liberado** só é consumido quando o My Hub realmente registra (recusa não gasta o "sim").
- **Roteamento:** pergunta só vale como consulta quando a palavra interrogativa está no começo ("quanto gastei…"); "gastei 45 quando fui ontem" é registro. Negação antes do verbo ("não gastei", "não registra") não registra. Resposta curta só completa dado quando a última frase do Beto é pergunta de registro e a resposta não é negativa. `claimsWrite` só considera negação colada ao verbo ("não anotei"); "Sem problema, anotei" é afirmação.
- **Rota:** o `[NEEDTOOLS]` com ferramentas só liga todos os conjuntos se **nenhuma** ferramenta executou (refazer depois de gravar duplicaria o registro).
