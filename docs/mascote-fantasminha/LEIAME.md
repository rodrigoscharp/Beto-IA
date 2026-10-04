# Beto — mascote 3D

## Arquivos
- `index.html` — o Beto (modelo + animações + API)
- `three-d-stage.js` — visualizador 3D (precisa ficar na mesma pasta)

three.js é carregado da CDN (unpkg) — precisa de internet. Abra via servidor (ex.: `npx serve`), não direto pelo `file://`.

## Como colocar no seu sistema
**Opção A — iframe (mais simples)**
```html
<iframe id="beto" src="/beto/index.html?tema=escuro" style="border:0;width:400px;height:400px"></iframe>
<script>
  const beto = () => document.getElementById('beto').contentWindow.beto;
  beto().setEmotion('feliz');
</script>
```
(mesmo domínio, para acessar `contentWindow.beto`)

**Opção B — direto na página:** copie o `<script type="importmap">`, o `<three-d-stage>` e o `<script type="module">` do `index.html` para a sua página.

Para esconder a barra de botões e o título: remova `#bar` e `.tag` do HTML.

## API (`window.beto`)
```js
beto.setEmotion('neutro' | 'feliz' | 'pensando' | 'surpreso' | 'triste' | 'dormindo' | 'dj' | 'bravo');
beto.talk(true);        // boca mexendo (enquanto a IA responde)
beto.talk(false);
beto.wave();            // acenar
beto.notify();          // animação de notificação (~3,6s)
beto.dj(true);          // modo DJ (Spotify)
beto.dj(false);
beto.setTheme('claro' | 'escuro');   // só o fundo muda
beto.emotion; beto.talking; beto.theme;   // leitura do estado
```
Tema também via URL: `?tema=escuro`, ou automático pelo sistema operacional.
