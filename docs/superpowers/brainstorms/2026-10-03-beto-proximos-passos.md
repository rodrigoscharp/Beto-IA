# Próximos passos do Beto

Brainstorm de 2026-10-03. Nada aqui está implementado. Continua o brainstorm de 2026-10-01 (`2026-10-01-beto-features.md`).

## O que já saiu desde o último brainstorm

Streaming com voz por frase, roteador de intenção, métricas, ferramentas nativas (Calendar completo, My Hub, memória), entrada por texto, verificador de modelos e voz de reserva (Google Chirp 3 HD).

## O que o histórico mostra

Cerca de 15 dos últimos 40 commits são `fix:` de falso positivo, rede de proteção, confirmação presa ou frase mal interpretada ("terminei o treino virou check-in"). O Beto quebra em fala do dia a dia. Antes de crescer, ele precisa de uma base que segure a qualidade.

---

## 1. Fundação: confiável antes de maior

- **Bateria de testes de fala:** cerca de 200 frases reais, cada uma com o resultado esperado (ferramenta e argumentos, ou "só conversa"). Roda em cada PR e todas as noites pelo cron. Cada bug corrigido vira um caso novo. Isso acaba com as "terceiras rodadas" de correção.
- **Modelo por tipo de turno:** o modelo pequeno e rápido fica com a conversa, e um modelo maior da Groq fica só com os turnos que usam ferramenta. O roteador já existe, então basta escolher o modelo pela intenção. Boa parte da rede de proteção existe porque o modelo 8b erra a chamada de ferramenta.
- **Senha fraca (ainda pendente):** o hash SHA-256 sem sal continua em `lib/auth.ts`, num repositório público. Trocar por passkey (WebAuthn) ou por um hash lento (scrypt) guardado em variável de ambiente.
- **Registro de ações:** uma tela que mostra o que o Beto fez em seu nome, com "desfazer" quando possível.

## 2. Ele age em mais lugares

- **Pesquisa na web:** notícias, cotação, placar e preço, com fonte citada. É a maior lacuna de hoje.
- **Spotify e Gmail como ferramentas nativas:** no Gmail, rascunho e resposta com confirmação por voz antes de enviar.
- **GitHub que age:** status do CI, "o que quebrou no último deploy" (pelos logs da Vercel) e abrir issue.
- **Consultar o My Hub, não só registrar:** "quanto gastei com mercado em setembro?", "qual hábito está parado?". Daí saem alertas de orçamento ("você passou de 80% do teto de lazer").
- **Casa inteligente** via Home Assistant, se houver: luz, ar-condicionado, "modo dormir".

## 3. Ele vive fora da aba do navegador

- **Beto no Telegram ou WhatsApp:** o mesmo cérebro e as mesmas ferramentas, com áudio na entrada (Whisper) e na saída. Funciona no carro, na rua e no iPhone, sem depender da Web Speech. Provavelmente o maior salto de uso.
- **Lembretes e rotinas no servidor:** "me lembra amanhã às 9" e "toda segunda às 8h me manda a semana" ficam salvos no Supabase e disparam pelo cron com push. Funcionam com o app fechado.
- **Tarefas em segundo plano:** "pesquisa 3 contadores em Floripa e me manda um resumo" roda num job durável (Vercel Workflow) e avisa por push quando termina.
- **Atalho da Siri** com endpoint autenticado.

## 4. Mais esperto

- **Memória semântica:** pgvector no Supabase. O Beto busca as memórias pelo assunto da conversa, não pelas 25 mais recentes.
- **Resumo entre sessões:** ao fechar a conversa, ele salva três linhas. Na conversa seguinte, abre com "ontem ficamos de fechar a proposta, fechou?".
- **Histórico no Supabase:** a conversa continua entre o celular e o PC.
- **Busca cruzada:** "o que combinei com a Maria?" procura nos emails, na agenda, na memória e nas notas.
- **Revisão semanal guiada:** no domingo à noite, mostra o que foi feito, o que escorregou e três prioridades. As respostas viram tarefas.

## 5. Mais vivo (voz e rosto)

- **Barge-in:** quando você fala, o Beto para de falar na hora.
- **Boca sincronizada de verdade:** a ElevenLabs devolve o tempo de cada caractere, então o rosto de partículas pode mexer a boca pelo áudio real.
- **Emoção na voz:** o `[emo:X]` também passa a ajustar o tom da fala (estabilidade e estilo, ou as tags de áudio do modelo v3).
- **Palavra de ativação offline:** openWakeWord ou Porcupine, para ouvir "Beto" sem manter o reconhecimento na nuvem sempre ligado.
- **Modos:** foco (pomodoro, playlist e avisos em silêncio), resenha e dirigindo (respostas curtíssimas, só voz).

---

## Ordem sugerida

1. Bateria de testes de fala e modelo por tipo de turno.
2. Troca da senha.
3. Pesquisa na web.
4. Lembretes e rotinas no servidor.
5. Canal Telegram ou WhatsApp com áudio.
6. Consultar o My Hub e Gmail que age.
7. Memória semântica e resumo entre sessões.
8. Barge-in e boca sincronizada.

## Perguntas para priorizar

1. Onde o Beto é mais usado: na mesa, no celular ou no carro? Se for no celular ou no carro, o canal Telegram ou WhatsApp sobe para o topo.
2. O que mais incomoda agora: ele errar a intenção, não saber coisas da internet, ou só funcionar com o app aberto?
3. Existe Home Assistant ou outra casa inteligente para integrar?
