# Prompt: trocar o visual do Beto pelo mascote 3D Fantasminha

Cole tudo abaixo da linha no Claude Code, na raiz do repositório `Beto-IA`.

---

Quero trocar totalmente o visual do Beto. Hoje ele é um rosto de partículas em canvas 2D (`components/Orb.tsx` + `components/face.ts`). Ele vai virar o mascote 3D **Fantasminha**, que criei no Claude Design. Antes de mudar qualquer coisa, leia este prompt inteiro, explore os arquivos citados e me mostre um plano curto. Depois execute.

## 1. Material de referência

O mascote está em `/Users/rodrigoscharp/Downloads/Ideias de ícones para Beto.zip`. Descompacte em `docs/mascote-fantasminha/` (ignore `__MACOSX`). São três arquivos:

- `index.html`: o modelo completo em three.js. Tem geometria, materiais, props de cada emoção, o loop `tick()` com todas as animações e a API `window.beto`.
- `three-d-stage.js`: um visualizador genérico (renderer, luz de estúdio, sombra no chão, OrbitControls, botões de exportar OBJ/GLB). Use só como referência de luz, sombra e câmera. **Não** traga OrbitControls, exportadores nem a barra de ferramentas.
- `LEIAME.md`: a API do mascote.

A fonte da verdade do visual é o `index.html`. Porte geometria, cores, proporções e timing das animações **fielmente**. Não "melhore" nem redesenhe o personagem.

API original do mascote:

```js
beto.setEmotion('neutro' | 'feliz' | 'pensando' | 'surpreso' | 'triste' | 'dormindo' | 'dj' | 'bravo');
beto.talk(true | false);   // boca mexendo
beto.wave();               // acenar (~2,2s)
beto.notify();             // notificação: pulo surpreso + envelope e badge (~3,6s)
beto.dj(true | false);
beto.setTheme('claro' | 'escuro');
```

## 2. Como integrar no Next.js (decisões já tomadas)

- Instale `three` (e `@types/three` em dev) via npm. **Não** use importmap nem CDN da unpkg: o app é Next 14 com bundler.
- Crie `components/mascot/` com:
  - `ghost.ts`: monta o modelo (`buildGhost(THREE)` devolve o `Group` e as referências das partes). Troque os globais `window.__ombro` e `window.__armL` por referências retornadas.
  - `animate.ts`: a lógica do `tick()` como função pura de estado + `dt` (`step(state, dt, now)`), sem DOM. Mantenha a tabela `EMO` e as transições suaves (`1 - Math.exp(-dt * k)`).
  - `BetoGhost.tsx`: componente client que cria renderer, cena, câmera, luzes e sombra, roda o loop e expõe props. Carregue com `next/dynamic` e `ssr: false`.
- Fundo do canvas **transparente** (`alpha: true`, sem `scene.background`). O fundo continua vindo dos tokens `--bg` de `app/globals.css`. Assim o modo claro e o escuro funcionam sem duplicar cor.
- Tema: o app já tem `useTheme()` (`"dark" | "light"`). Mapeie `dark` para `escuro` e `light` para `claro`. No mascote, o tema só muda a opacidade da sombra no chão (0.45 escuro, 0.18 claro), como no original. Ajuste a luz se o corpo branco "estourar" no fundo claro `#f4f6fa`.
- Câmera fixa, enquadrada no mascote **com folga para os props** (nuvem de chuva em cima, Zzz, notas do DJ, vapor do bravo, badge da notificação). Nada pode ser cortado em nenhuma emoção.
- Tamanho: o mascote ocupa o mesmo espaço que o Orb ocupa hoje e escala com a viewport (veja `REF` e `R` em `Orb.tsx`). Funciona em celular retrato e nas janelas pequenas da regra `.beto-chrome` de `globals.css`.
- Desempenho: `setPixelRatio(Math.min(devicePixelRatio, 2))`, pause o loop com `document.hidden`, faça `dispose()` de geometrias, materiais e renderer no unmount, e redimensione com `ResizeObserver`.
- `prefers-reduced-motion`: mantenha as expressões, mas corte flutuação, pulos, tremor e giro. A boca ainda mexe ao falar.
- Se o WebGL falhar, mostre um fallback simples (um SVG 2D do fantasminha) em vez de tela vazia.

## 3. Mapeamento: estados do app para o mascote

Substitua `<Orb .../>` em `app/page.tsx` (linha ~1190) por `<BetoGhost .../>`. Mantenha as mesmas props (`state`, `emotion`, `talking`, `onClick`, `theme`) e adicione as novas abaixo.

Estado de voz (`OrbState`):

| Estado do app | Mascote |
|---|---|
| `wake` (ocioso, esperando o nome) | `dormindo` (Zzz). Se tiver música tocando, `dj` |
| `listening` | `surpreso` suave (olhos abertos, atento). Não use a versão exagerada: crie um preset `ouvindo` em `EMO` com olhos ~1.1 e boca pequena |
| `thinking` | `pensando` (óculos + prancheta) |
| `speaking` | a emoção da resposta (tabela abaixo) + `talk(talking)` |

Emoção da resposta (tag `[emo:X]` do modelo, 9 valores) para o mascote (8 valores):

| `Emotion` | Mascote |
|---|---|
| `neutro` | `neutro` |
| `alegre` | `feliz` |
| `animado` | `feliz` + um pulinho extra ao começar a falar |
| `pensativo` | `pensando` |
| `bravo` | `bravo` |
| `nervoso` | `surpreso` + tremor leve (reaproveite o `tremble` do bravo, com amplitude menor) |
| `surpreso` | `surpreso` |
| `triste` | `triste` |
| `sarcastico` | `neutro` + cabeça inclinada (`tilt`) e meio sorriso. Crie o preset `sarcastico` em `EMO` |

**Não** mude a lista de emoções do prompt do modelo (`lib/prompt.ts`) nem o formato da tag. O mapeamento acontece só no front.

`talking` continua sendo a verdade da boca. A boca só mexe com o áudio de fato tocando. No `speaking`, enquanto o TTS faz prebuffer, a boca fica parada.

Eventos pontuais (props novas ou um `ref` com métodos `wave()` e `notify()`):

- **Saudação**: quando `greetingKind()` reconhece "bom dia", "oi", "tudo bem" etc. (fluxo `turnVia = "greeting"` em `app/page.tsx`), dispare `wave()` junto com a fala.
- **Notificação proativa**: no `announce` de `useProactive` (`app/page.tsx` ~linha 201), dispare `notify()` antes de falar o aviso.
- **DJ**: o `MiniPlayer` já informa `onPlaying` (hoje vai só para `musicPlaying.current`). Transforme isso em estado e, com música tocando e o Beto ocioso, use `dj`. Quando ele começar a ouvir ou falar, sai do DJ e volta quando terminar.

Prioridade quando duas coisas acontecem juntas: `notify` > `wave` > estado de voz > DJ.

Clique: o canvas inteiro chama `onClick`, como o Orb. Mostre cursor pointer.

## 4. O que remover ou adaptar

- `components/Orb.tsx`: apague depois que o `BetoGhost` estiver funcionando.
- `components/face.ts`: mantenha **só** o que o app ainda usa: `EMOTIONS`, `Emotion`, `EMOTION_TAG`, `emotionFromName`, `parseEmotion` (e `FaceState` se ainda for importado). Mova para `lib/emotion.ts` e atualize os imports. Apague presets de partícula, `faceTargets`, `lerpFace`, `applyLife` e `clusterOf`.
- `scripts/face.test.mjs`: mantenha os testes de `parseEmotion`, `EMOTION_TAG` e `emotionFromName` (apontando para o novo arquivo). Apague os testes de partícula. Adicione testes para o mapeamento app→mascote e para `animate.ts` (nenhuma emoção nem transição gera `NaN`; `notify` e `wave` terminam e voltam ao estado anterior).
- `app/preview-face/`: vira uma galeria do mascote. Um botão para cada emoção do mascote e do app, cada estado de voz, falar/parar, acenar, notificação, DJ e claro/escuro. É onde eu vou conferir tudo.
- Ícones do PWA (`public/icons/icon.svg`, `npm run icons`): troque o anel com estrela por um fantasminha 2D em SVG (corpo `#F6F3EC`, olhos `#16140F`, boca `#FF6B2C`, bochechas `#FF9A6B`), dentro da zona segura de 80% do maskable. Gere os PNGs e suba o `?v=` no `app/manifest.ts`.

## 5. Paleta do mascote (do `index.html`)

Corpo `#F6F3EC`, olho `#16140F`, brilho `#FFFFFF`, laranja da boca e detalhes `#FF6B2C`, bochecha `#FF9A6B`, Zzz `#6B7FD7`, notas do DJ `#7C6CF2`, lágrima `#8FC3F2`, nuvem `#9AA3B5`, estrelinhas `#FFC94A`, rubor do bravo `#FFB4A0`. O resto da UI (legenda, MiniPlayer, botões) continua com o tema atual. Só me avise se algo brigar visualmente com o mascote.

## 6. Como trabalhar

1. Crie a branch `feat/mascote-3d` a partir da `main`.
2. Primeiro porte o modelo e as animações e valide na `/preview-face`. Só depois troque o Orb na página principal.
3. Rode `npm test`, `npm run lint` e `npm run build`. Tudo tem que passar.
4. Abra o dev server e confira cada emoção, estado, aceno, notificação, DJ e fala, nos modos claro e escuro e em viewport de celular. Veja o console: nenhum erro nem warning de WebGL. Me mande screenshots.
5. Commits pequenos e em português, no padrão do repositório (`feat:`, `fix:`, `refactor:`). Não faça push nem merge sem eu pedir.

No fim, me diga o que ficou diferente do `index.html` original e por quê, e o tamanho que o `three` acrescentou ao bundle da página.
