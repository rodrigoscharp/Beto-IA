# Como deixar as expressões do Beto as melhores possíveis

Brainstorm de 2026-09-30, depois da primeira versão do rosto (branch `feat/beto-face`). Nada aqui está implementado. A lista vem ordenada por impacto sobre custo e risco, e termina com uma sugestão do que fazer primeiro.

## Onde está o teto hoje

1. **A pose é boa, o movimento é genérico.** Todas as emoções interpolam na mesma velocidade (`lerpFace` a 0.12 por frame) e têm o mesmo "idle" (piscar + deriva do olhar). Uma expressão vive mais no jeito de chegar e de se mexer do que na pose parada.
2. **A boca mexe por um LFO aleatório**, sem relação com o áudio. Dá para ver que não é a voz.
3. **O Beto só reage ao que ele mesmo diz.** Enquanto você fala, o rosto fica em `listening`, igual para tudo.
4. **Uma emoção por resposta inteira.** Uma resposta de 100 palavras tem começo, meio e fim; o rosto não.
5. **Não sabemos se o Groq obedece a tag.** Sem medir, qualquer melhoria de rosto pode estar sendo desperdiçada numa resposta que saiu "neutro" por esquecimento.

## Ideias

### A. Personalidade de movimento por emoção (alto impacto, baixo risco)

Cada emoção ganha um perfil de movimento, além da pose. Tudo dentro de `face.ts`/`Orb.tsx`, sem mudar API.

- **Velocidade e mola por emoção:** `bravo` e `surpreso` chegam rápido e com overshoot (estalo); `triste` e `pensativo` chegam devagar e pesados; `animado` quica. Hoje é um único `0.12`; vira um campo `snap` no preset.
- **Idle próprio:** `nervoso` com olhar que corre de um lado ao outro e piscar rápido; `pensativo` com piscar lento e olhar que se afasta; `sarcastico` com um pulso da sobrancelha alta; `bravo` com tique na sobrancelha; `triste` com um "suspiro" (rosto afunda um pouco e volta); `alegre` com leve balanço da cabeça.
- **Arco da fala:** a emoção entra forte no início e relaxa para o neutro no fim da frase, em vez de ficar congelada até o último áudio.
- **Antecipação:** um frame de contra-movimento antes de uma mudança grande (olho fecha um pouco antes de arregalar). Barato e muda muito a sensação de "vida".

### B. Boca de verdade (alto impacto, médio custo)

- **Nível 1: amplitude do áudio.** Um `AnalyserNode` ligado ao `<audio>` (MediaElementSource) dá o volume real; a abertura da boca passa a seguir a voz. Resolve o "parece dublado". Cuidado: o `MediaSource` em streaming e o `audio.play()` precisam continuar funcionando com o nó no meio; testar em Safari/iOS, que é onde o PWA roda.
- **Nível 2: visemas com timestamps.** A API de TTS da ElevenLabs tem variante com alinhamento por caractere. Com isso dá para abrir "a/o/u" e fechar em "m/b/p" de verdade. É a melhor qualidade, mas troca o endpoint de streaming e mexe no prebuffer; só vale se o nível 1 não bastar.
- **Sem custo:** suavizar o LFO atual com a duração do texto (palavras por segundo) e pausar a boca nas vírgulas e pontos.

### C. Mais expressão no rosto em si (alto impacto visual, baixo risco)

- **Pupilas e brilho:** hoje o olho é uma mancha. Pupila que segue `gaze` e um ponto de brilho (catchlight) deixam o olho vivo. `animado` com brilho maior, `triste` com brilho turvo.
- **Bochechas** (aglomerado rosado) para `alegre`/`animado`; **gota de suor** para `nervoso`; **lágrima** escorrendo em `triste`; **fumaça/rubor** em `bravo`; **estrelinhas** em `animado`; **pontos de interrogação/reticências** em `pensativo`. Tudo feito com as mesmas partículas (quebra a regra de 320 fixas só se passar de um pequeno orçamento, então sugiro reservar ~24 do "pó" do anel para esses efeitos).
- **Sobrancelhas e pálpebras mais expressivas:** pálpebra de cima e de baixo independentes, sobrancelha com dois segmentos para um "V" mais agudo no `bravo` e uma ruga no `pensativo`.
- **Brilho e cor por emoção:** intensidade do glow e saturação variando (mais quente e forte no `animado`, mais frio e baixo no `triste`). A cor já varia por `hue`.

### D. O Beto reage a você (alto impacto, médio custo)

- **Espelhar o usuário enquanto ouve:** sentimento simples do que você acabou de falar (palavras de agradecimento, palavrões, "caramba", "não funcionou") muda o rosto de `listening` antes de o Beto responder. Começa com regras de palavras-chave, sem nova chamada ao modelo.
- **Olhar que segue o toque/mouse:** os olhos vão para onde você clicou ou para onde o ponteiro está. Dá muita presença por quase nada de código.
- **Olhar para o player** quando está tocando música e "balançar" no ritmo (o `now-playing` do Spotify já existe).

### E. Contexto, não só a resposta (médio impacto)

- **Emoção proativa:** alerta de email urgente = `surpreso`/`nervoso`; briefing de bom dia = `alegre`; hábito parado há dias = `bravo` leve ("chefe, cadê o treino?"); fim de pomodoro = `animado`. Hoje os alertas saem `neutro`.
- **Humor por horário:** sonolento de madrugada (olho mais baixo), cheio de energia de manhã.
- **Acordar e dormir:** animação de abrir os olhos devagar ao sair de `wake`; bocejo e "zzz" depois de muito tempo parado.

### F. Qualidade da marcação do LLM (base de tudo; fazer antes do resto)

- **Medir primeiro.** Registrar (console ou Supabase) a emoção de cada resposta e se a tag veio ou caiu no fallback. Duas semanas de uso mostram a taxa de esquecimento e se o modelo vive no `neutro`.
- **Exemplos no prompt:** hoje o prompt descreve cada emoção em uma linha. Uma tabela curta de 9 a 12 exemplos reais em português ("deu certo!" → alegre; "o servidor caiu" → nervoso; "você errou a conta" → bravo) costuma subir muito a obediência e a variedade.
- **Intensidade:** `[emo:bravo]` vs. `[emo:bravo:2]` (leve, forte). Dá para ter 9 x 3 rostos sem desenhar 27 presets: a intensidade só escala os parâmetros entre `neutro` e o preset.
- **Emoção por trecho:** a resposta vem como sequência de trechos, cada um com sua tag, e o rosto muda no ponto certo do áudio (precisa dos timestamps do item B2 para ficar exato). É o salto de "ator lendo" para "ator atuando", mas é a maior obra da lista.
- **Plano B já previsto:** se a tag no início não pegar, pedir JSON `{emocao, texto}` (o Groq tem modo JSON).

### G. Robustez e ferramentas

- **Galeria de teste de prompt:** um script com ~20 frases-tipo que chama o modelo e mostra a emoção devolvida, para medir mudanças de prompt sem falar ao microfone.
- **Modo debug no `/preview-face`:** mostrar a emoção atual, a última tag crua e um slider de intensidade.
- **Desempenho:** contar custo por frame no iPhone antigo e, se precisar, reduzir o número de partículas em aparelho fraco.
- **Acessibilidade:** a legenda já mostra o texto; o rosto não pode ser o único canal de emoção (o texto já carrega o tom).

## Sugestão do que fazer primeiro

1. **F1 (medir) + F2 (exemplos no prompt):** barato e define se o resto vale a pena.
2. **A (personalidade de movimento):** maior ganho de "vida" por linha de código, sem risco de áudio.
3. **C1 (pupilas e brilho) + bochechas/lágrima/suor:** faz o rosto parecer desenhado de propósito.
4. **B1 (boca pela amplitude do áudio):** o que mais tira a sensação de "boca aleatória"; testar bem no iOS.
5. **D2 (olhar segue o toque) e E (emoção proativa):** presença e contexto, ambos pequenos.
6. **Depois:** intensidade (F3), espelhar o usuário (D1), e só então visemas e emoção por trecho (B2, F4), que são obras maiores.

## Perguntas para você decidir

- Qual é a prioridade: o Beto mais **engraçado/carismático** (A, C, F2) ou mais **realista** (B, visemas)?
- Posso gastar partículas em efeitos (lágrima, suor, estrelas) ou você prefere o rosto "limpo"?
- Aceita registrar as emoções devolvidas pelo modelo (só a palavra, sem texto da conversa) para medir?
- O Beto pode reagir ao tom da sua voz/fala antes de responder (D1), ou só ao que ele próprio diz?
