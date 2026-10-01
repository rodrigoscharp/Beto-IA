# Como fazer do Beto o melhor assistente possível

Brainstorm de 2026-10-01. Nada aqui está implementado. As ideias partem do que o Beto já faz hoje, do código e dos logs de produção, não de uma lista genérica.

## O ponto de partida

**O que já existe:** voz com palavra de ativação, chat com 7 modelos de reserva na Groq, Spotify, Google Calendar (criar e listar), Gmail (resumo e leitura), GitHub (só leitura: PRs, issues, commits), timer e pomodoro, briefing do dia, memória no Supabase, My Hub (registrar gastos, hábitos e tarefas, com desfazer), avisos proativos por push (email, agenda, My Hub, GitHub) e agora o rosto expressivo.

**Onde ele perde tempo ou dinheiro hoje:**

1. **Resposta só começa quando tudo termina.** O fluxo é: você fala → o servidor pede a resposta inteira ao modelo (sem streaming) → manda o texto inteiro para o TTS → só então toca. Depois que tiramos as frases de enrolação, esse intervalo ficou à mostra.
2. **O prompt é enorme.** Todo pedido carrega a personalidade, o bloco de cada integração (Spotify, Calendar, GitHub, Gmail, timer, briefing, memória, My Hub) e as memórias, mesmo quando você só perguntou "como você está". Mais texto de entrada é mais latência e mais custo.
3. **A voz tem cota curta.** A ElevenLabs recusou com `quota_exceeded` (10.000 créditos). Uma resposta de 100 palavras gasta muito mais que uma de 20.
4. **Modelo morto na lista.** Os logs mostram `llama-3.1-8b-instant` com 404. A lista de modelos envelhece sozinha e ninguém avisa.
5. **Só dá para falar.** Em reunião, no transporte ou à noite, não tem como digitar para o Beto.
6. **O Beto lê, quase nunca age.** GitHub e Gmail são só leitura; Calendar só cria e lista.
7. **Ele não tem internet.** O próprio prompt diz que não sabe notícias, cotação, placar nem clima fora do briefing.

---

## A. Mais rápido (o que você sente na hora)

| Ideia | O que muda | Esforço |
|---|---|---|
| **Streaming da resposta + voz por frase** | O modelo responde em fluxo; assim que a primeira frase fecha, ela já vai para o TTS e toca enquanto o resto ainda chega. É o maior ganho de "tempo até começar a falar". As tags (`[emo:X]`, `[SPOTIFY:…]`) ficam no início, então o parser continua simples. | Médio |
| **Roteador de intenção** | Uma checagem barata decide se o pedido é conversa, música, agenda, email, GitHub, My Hub ou memória. Conversa simples vai com o prompt curto (só personalidade); cada integração só carrega o seu bloco. Menos tokens, resposta mais rápida e mais barata. | Médio |
| **Respostas curtas por padrão, detalhe sob demanda** | Ele fala o essencial em 1 a 3 frases e a versão completa vai para a tela ("quer que eu detalhe?"). Ajuda a velocidade, a cota da voz e o uso no dia a dia. | Baixo |
| **Atalhos locais sem modelo** | Pausar, próxima, volume, "que horas são", "quanto falta no timer": resolvidos no navegador, na hora, como já é com as saudações. | Baixo |
| **Busca de memórias e My Hub só quando importa** | Hoje as duas buscas rodam em todo pedido (com cache de 5 min). O roteador pode pular quando não há relação. | Baixo |
| **Região da função perto da Groq** | Conferir a região do `/api/chat` (hoje `iad1`) e o tempo de ida e volta de cada etapa; medir antes de otimizar. | Baixo |
| **STT melhor e que funciona no iPhone** | O reconhecimento de voz do navegador (Web Speech) é inconsistente e quase não existe em PWA no iOS. Whisper na Groq (rápido e barato) com detecção de fim de fala dá transcrição mais precisa e funciona em qualquer aparelho. | Médio |

## B. Mais barato e mais confiável

- **Painel de cota da ElevenLabs:** ler o endpoint de assinatura, mostrar o saldo discreto na tela e avisar por push quando passar de 80%. Nunca mais descobrir pela voz que mudou.
- **Cache de frases que se repetem** (confirmações curtas como "Pronto, chefe."), além das saudações.
- **Modelo de TTS mais barato** (os modelos "flash" da própria ElevenLabs), mantendo a mesma voz, se a qualidade bastar.
- **Verificador de modelos:** um teste diário (cron que já existe para os alertas) que chama cada modelo da lista, remove os mortos e avisa quando sobra pouco. Fim do 404 silencioso.
- **Telemetria mínima:** registrar por resposta o modelo usado, o tempo de cada etapa (modelo, TTS, primeiro áudio) e se a tag de emoção veio. Sem o texto da conversa. Sem medir, qualquer otimização é chute.
- **Observabilidade de erro:** avisar por push quando `/api/chat` ou `/api/tts` falhar várias vezes seguidas.

## C. Mais capaz (o Beto passa a agir, não só ler)

- **Chamada de ferramentas em vez de tags no texto.** Hoje o modelo escreve `[SPOTIFY:{…}]` dentro da resposta. O formato nativo de ferramentas da Groq é mais confiável, permite várias ações em sequência ("marca com a Maria amanhã às 15h e me manda o link") e dispensa o parse de texto.
- **Calendar completo:** editar, remarcar, cancelar, achar horário livre entre duas pessoas, avisar de conflito.
- **Gmail que age:** criar rascunho de resposta, responder e arquivar, sempre mostrando o texto e pedindo confirmação antes de enviar.
- **GitHub que age:** comentar em PR, abrir issue, ver o status do CI, "o que quebrou no último deploy?" (a Vercel já tem logs).
- **Pesquisa na web:** notícias, cotações, placar, clima, preço de produto, com fontes citadas. Fecha a lacuna "não tenho internet".
- **Lembretes que sobrevivem ao navegador:** hoje o timer vive na página. Lembretes no servidor com push ("me lembra de ligar para o contador amanhã às 9") funcionam com o app fechado.
- **Captura rápida:** "anota aí" vira nota ou tarefa no My Hub, sem escolher categoria.
- **Entrada por texto:** um campo discreto para digitar. O mesmo cérebro, sem voz, para reunião e transporte.
- **Foto para registro:** a Groq tem modelos com visão (já na sua lista). Fotografar um comprovante e o Beto registrar o gasto no My Hub, com confirmação.
- **Ações em lote ("modos"):** "modo foco" = pomodoro + playlist de foco + silenciar avisos; "fim de dia" = resumo + pendências de amanhã.

## D. Mais proativo (ele te procura)

- **Briefing no horário certo,** sem pedir: cron + push às 7h30 com agenda, emails que importam, clima e o que está atrasado no My Hub.
- **Resumo de fim de dia e revisão da semana:** o que foi feito, o que escorregou, três prioridades para amanhã.
- **Cobrança de hábito com contexto:** o Beto já sabe quando "o hábito de estudar está parado há três dias". Usar isso em horário útil, não só quando você abre o app.
- **Antecipação de agenda:** "sua reunião com o cliente é em 20 minutos, o doc que você citou segue sem revisão."
- **Atalho do iPhone/Siri:** um endpoint seguro que o Atalhos chama ("Ei Siri, Beto, …") e que devolve a resposta falada. É o jeito mais direto de ter o Beto sem abrir o app.

## E. Mais inteligente (memória e contexto)

- **Memória semântica:** hoje ele lista as 25 memórias mais recentes. Com busca por significado (embeddings no próprio Supabase), traz só o que é relevante para o assunto.
- **Resumo entre sessões:** o histórico é só dos últimos 20 turnos e some ao fechar. Um resumo curto salvo no fim da conversa dá continuidade ("ontem a gente ficou de decidir o plano da proposta").
- **Esquecer e corrigir:** "esquece isso", "isso mudou". Sem controle, a memória só acumula.
- **Busca no que é seu:** "o que combinei com a Maria?" cruzando emails, agenda e notas.
- **Perfis de tom:** trabalho / resenha / foco, ativáveis por voz, em vez de depender do modelo adivinhar.

## F. Segurança (vale tratar cedo, porque ele acessa Gmail, GitHub e Calendar)

- **Senha com hash fraco num repositório público.** O código de login diz que o hash SHA-256 da senha está no repositório, e SHA-256 sem sal se quebra por força bruta offline. Quem quebrar a senha entra em tudo que o Beto acessa. Troca recomendada: passkey (WebAuthn) ou, no mínimo, hash lento com sal guardado só em variável de ambiente. O limite de tentativas atual protege só o login online.
- **Injeção de prompt por email:** o Beto lê emails de terceiros. O prompt já proíbe resumir o conteúdo por conta própria; vale reforçar com uma regra de código (conteúdo de email nunca aciona ferramenta sem confirmação por voz).
- **Confirmação para ações irreversíveis:** enviar email, apagar evento, comentar em PR. Hoje o My Hub tem "desfazer"; as novas ações precisam do mesmo cuidado.
- **Registro de ações:** uma lista simples do que o Beto fez em seu nome (tela ou push), para auditoria.

---

## Minha sugestão de ordem

**Onda 1: velocidade e custo (1 a 2 dias, o que você mais sente)**
1. Telemetria mínima, para medir o antes e o depois.
2. Streaming + voz por frase.
3. Roteador de intenção (prompt curto para conversa).
4. Respostas curtas por padrão e painel de cota da ElevenLabs.
5. Verificador de modelos (cron).

**Onda 2: segurança (pequena e importante)**
6. Troca da autenticação por passkey ou hash forte.

**Onda 3: ele passa a agir**
7. Ferramentas nativas no lugar das tags.
8. Calendar completo e Gmail com rascunho/confirmação.
9. Pesquisa na web.
10. Entrada por texto e lembretes no servidor.

**Onda 4: proatividade e inteligência**
11. Briefing e resumo de fim de dia automáticos.
12. Atalho do Siri.
13. Memória semântica e resumo entre sessões.
14. Foto para registro e modos.

## O que eu preciso de você para priorizar

1. **O que mais te incomoda hoje: a espera, a voz, ou ele não fazer o que você pede?** A resposta define se começamos pela Onda 1 ou pela 3.
2. **Plano da ElevenLabs:** você está disposto a pagar um plano maior? Isso muda o quanto vale economizar voz (respostas curtas, cache) contra deixar ele falar mais.
3. **Onde você mais usa o Beto?** Mesa, celular ou carro? Isso decide entre PWA, entrada por texto e Siri.
4. **Quais ações ele pode fazer sozinho e quais precisam do seu "pode"?** Enviar email e comentar em PR são exemplos.
5. **Você aceita registrar métricas de tempo e modelo (sem o texto das conversas)?**
