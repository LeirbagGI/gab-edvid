# Edvid

Edição de vídeo assistida por IA. Você grava, joga os arquivos no sistema e ele
entrega o corte para aprovação e depois o vídeo final montado.

Mora em `~/gab-edvid` — **fora do Google Drive** de propósito: `node_modules`,
vídeo bruto, renders e o modelo do Whisper (1,5 GB) não podem sincronizar.

## Uso normal

```bash
npm run preview     # deixe rodando numa aba do terminal
```

Abra **http://localhost:4820/** e trabalhe por lá. A tela é o **chat à esquerda**
e o **editor à direita**, como na referência:

- aba **Projetos** — arraste vídeos (vários de uma vez). Cada um vira um projeto
  e entra na fila. Também tem "Varrer a pasta de entrada" para pegar o que você
  jogou em `~/Desktop/Edicao Edvid/` pelo Finder.
- aba **FASE 1 Corte** — revise a timeline, troque o bloco de um clipe, desligue
  o que não presta e aprove. O preview ocupa a altura toda da direita.
  **Controle da agulha:** arraste a agulha laranja, ou clique/arraste na régua,
  na trilha de marcadores ou na waveform. Setas ← → andam quadro a quadro
  (com Shift, 1 s) e espaço dá play/pause. Tocando, a timeline rola sozinha
  para acompanhar.
- aba **Estilo** — tipo de edição, cor de destaque, headline, legenda, elementos.
- aba **FASE 2 Visual** — headline, b-roll, trilha, e o render final.

## Pela linha de comando

```bash
npm run edvid                        # Fase 1 no vídeo mais novo da pasta de entrada
npm run edvid -- <arquivo> "<nome>"  # Fase 1 num arquivo específico
npm run edvid -- --lote              # Fase 1 em todos os vídeos ainda não processados
npm run edvid -- --fase2 "<nome>"    # render final de um projeto aprovado
npm run edvid -- --fase2-lote        # render final de todos os aprovados
npm run edvid -- --refazer "<nome>"  # refaz o corte com a timeline editada
npm run edvid -- --listar
npm run teste
```

## O chat lateral

O chat mostra o passo a passo: cada etapa do pipeline escreve ali o que fez, e
o histórico fica salvo no `projeto.json` — quem abrir o projeto semana que vem lê
a mesma narração. Sai coisa assim:

> Peguei IMG_8885.MOV — 166s de bruto, 2160×3840. Transcrevi palavra a palavra e
> montei o corte orgânico.
> Tirei 3 trechos: 2 respiros, 1 falso começo. Níveis equilibrados (+4 dB no
> HOOK), loudness em −14 LUFS.
> ▸ Escreveu **projeto.json**, 2 ferramentas  +21 −0
> Fase 1 pronta — fase1-corte.mp4, 16,1s, 1080×1920 30fps.
> *(tabela com # / Beat / Fala de cada clipe)*

**O campo de texto executa comandos de verdade** — não é enfeite:
`aprovar` · `pedir ajuste` · `refazer o corte` · `renderizar a fase 2` ·
`cor #FF5200` · `legenda karaokê` · `headline contorno` · `tela dividida` ·
`liga o flash` · `tirar o clipe 5` · `o que ficou no corte`.

O botão **Confirmar e iniciar a Fase 2** (aba Estilo) e o comando
`renderizar a fase 2` fazem a mesma coisa: colocam o render na fila.

### Os três modos do chat

| Modo | Quando | Custo | Confiabilidade |
|---|---|---|---|
| **Claude** | a ponte-claude está de pé e responde `/saude` | pela assinatura, sem chave | alta |
| **Local** | Ollama rodando com o modelo baixado | **zero** | boa, erra às vezes |
| **Comandos** | nenhum dos dois | zero | só as frases fixas |

O sistema escolhe sozinho, nessa ordem. O rodapé do chat diz em qual você está.

**Modo Claude** fala com a **ponte-claude**: um serviço fora deste repositório
que chama o Claude CLI da assinatura (`claude -p`, modelo `claude-fable-5-1`).
Não existe `ANTHROPIC_API_KEY` em lugar nenhum — quem autentica é o
`ant auth login` do lado da ponte. As ferramentas do editor (aprovar, mudar
estilo, ligar elemento...) são expostas por um servidor MCP embutido
(`src/server/mcp.js`, rota `/mcp/:nome`), e o Claude as chama por lá — mesma
lógica dos botões, sem caminho paralelo. `PONTE_URL` (`~/gab-edvid/.env`, veja
`.env.exemplo`) diz onde a ponte está; o padrão é `http://127.0.0.1:4821`.

**Modo local** (grátis, offline): `brew install ollama`, depois `ollama serve` e
`ollama pull qwen2.5:7b`. Roda na sua máquina, não manda nada para fora, não
consome cota. Um modelo de 7B erra mais que o Fable: às vezes chama a
ferramenta errada ou nenhuma.

**Por isso existe a trava de verdade** (`conferir`, em `src/server/ferramentas.js`):
o texto do modelo é conferido contra as ferramentas que realmente rodaram. Se
ele disser "mudei a cor" sem ter mudado, o chat mostra o aviso:

> ⚠ Na verdade não mudei nada — não executei nenhuma ação.

Nunca confie na prosa do modelo: confie na linha `✓`, que vem do resultado real
da ferramenta.

O rodapé do chat diz em qual modo você está. Sem a ponte no ar nada quebra:
cai no modelo local ou, na falta dele, no interpretador de comandos
(`src/server/comandos.js`).

**Limite de 20 mensagens por projeto.** Cada mensagem no modo Claude custa
tokens da assinatura, então cada projeto tem uma cota. O rodapé do chat mostra
quanto resta (`fable 5.1 · 14/20 mensagens`) e avisa nas três últimas.

Ao acabar a cota o chat **não trava**: cai nos comandos fixos e diz por quê.
Clicar no contador libera mais 20 naquele projeto. O modo de comandos é de
graça e nunca consome cota. O número está em `src/shared/config.js`
(`LIMITE_CHAT`).

No modo Claude ele usa as mesmas ações do resto do sistema como ferramentas
(`src/server/ferramentas.js`): aprovar, pedir ajuste, refazer o corte,
renderizar a Fase 2, mudar estilo, ligar/desligar elemento, ligar/desligar
clipe e mostrar a tabela do corte. Ele não tem caminho paralelo — faz o mesmo
que os botões.

## Fase 1 — o corte orgânico

1. **Transcreve** com Whisper (`large-v3-turbo`) palavra a palavra — é esse
   timestamp por palavra que permite a legenda karaokê na Fase 2.
2. **Agrupa em falas**, quebrando em pausa longa, fim de frase e vírgula com
   respiro.
3. **Descarta** respiro solto, muleta (`ah`, `hum`, `tipo`), falso começo (a
   frase seguinte engloba a anterior) e tomada repetida.
4. **Fecha as bordas** com padding, sem invadir a fala vizinha.
5. **Classifica** em `HOOK → DINÂMICA → RECURSOS → CTA`, sempre nessa ordem.
6. **Renderiza** 1080×1920 30fps, +4 dB no HOOK, loudness −14 LUFS.
7. Gera **filmstrips** e **waveform** para a timeline.

## Fase 2 — o visual

Renderizada em **Remotion**. Os presets vivem num arquivo só
(`src/shared/presets.js`), importado tanto pelo navegador quanto pela
composição — então o card da aba Estilo e o que sai no vídeo não podem divergir.

Os cards da aba Estilo são **animados**: cada um roda em loop a mesma animação
que o preset faz no vídeo — a legenda revela palavra por palavra na janela do
preset, com a palavra atual na cor de destaque; a headline entra e sai. Um único
`requestAnimationFrame` move todos, e ele só gasta quadro com a aba aberta.

| Elemento | O que faz | Precisa de |
|---|---|---|
| Headline | aparece durante o bloco HOOK | texto (sugerido a partir do hook) |
| Legenda | karaokê palavra a palavra na cor de destaque | nada |
| Automação de zoom in | zoom lento ao longo do clipe | nada |
| Zoom in/out nos cortes | empurrão alternado de 0,35 s após cada corte | nada |
| Movimento de tracking | deriva lenta na horizontal | nada |
| Flash na transição | clarão branco de 0,13 s no corte | nada |
| Tela dividida (1 e 2) | imagem em cima ou embaixo, rodízio por clipe | imagens em `broll/` |
| Trilha sonora | música mixada a 9% por baixo da fala | `trilha.mp3` no projeto |

**O que o sistema não faz sozinho:** gerar as imagens de b-roll e compor a
música. Você envia os arquivos pela aba FASE 2 (ou joga em
`projetos/<nome>/broll/` e `projetos/<nome>/trilha.mp3`). Sem eles, a tela
dividida cai para Limpa e o vídeo sai sem música — e o render avisa.

## Vários vídeos

A fila (`src/server/fila.js`) roda **um trabalho por vez**, de propósito:
transcrição e render saturam a CPU, e dois em paralelo terminam mais devagar que
dois em sequência. Também é o que permite um bundle único do Remotion servir
todos os projetos — depois do primeiro, cada render economiza ~20 s.

Um trabalho que falha não derruba a fila: ele fica marcado como erro e o próximo
começa.

Referência de tempo: dois vídeos de 20 s levaram 52 s para o render da Fase 2
(bundle já quente).

## Estrutura

```
src/
  cli.js                   comando de terminal
  shared/config.js         pasta de entrada, porta, parâmetros do corte
  shared/presets.js        estilos de headline/legenda (UI + render)
  shared/exec.js           ffmpeg / ffprobe
  fase1/transcrever.js     wav + whisper + silencedetect
  fase1/corte.js           o corte orgânico (lógica pura, testada)
  fase1/render.js          filter_complex, filmstrips, waveform
  fase1/projeto.js         estado em disco + orquestração
  fase2/render.js          bundle e render do Remotion
  server/index.js          API, upload, WebSocket
  server/fila.js           fila serial de trabalhos (testada)
  server/comandos.js       o interpretador do chat
  shared/conversa.js       as mensagens do passo a passo
remotion/
  Reel.jsx                 a composição: vídeo, zoom, headline, legenda, trilha
public/                    preview (index.html + app.js, sem build)
projetos/<nome>/           projeto.json, fase1-corte.mp4, fase2-final.mp4,
                           thumbs/, broll/, trilha.mp3, trabalho/
models/                    ggml-large-v3-turbo.bin
```

Cada projeto é uma pasta com um `projeto.json` — todo o estado está lá, legível
e editável à mão.

## Detalhes chatos que valem saber

O bundle do Remotion fica em memória entre renders (é o que faz o lote ser
rápido). Ele guarda uma assinatura com o mtime de `remotion/*.jsx` e
`src/shared/*.js`: se você editar a composição com o servidor de pé, ele
reempacota sozinho em vez de renderizar com a versão velha.



O Remotion serve `staticFile()` de `<bundle>/public` e ignora o `publicDir` do
`renderMedia` quando o bundle é uma pasta local. Por isso, antes de cada render,
`fase2/render.js` aponta esse caminho para a pasta do projeto por symlink. É
mais um motivo para a fila ser serial: dois renders ao mesmo tempo brigariam
por esse link.

## Fontes

As legendas usam fontes de verdade, baixadas do Google Fonts (licença aberta) e
guardadas em `public/fontes/`:

| Fonte | Usada em |
|---|---|
| Montserrat | Karaokê, headline arredondada |
| Poppins | Contorno, barra sólida, caixa branca |
| Anton | Palavra única |
| Bebas Neue | Condensada, headline caixa |
| Archivo Black | reserva do Cartoon |
| Luckiest Guy | Cartoon |

Elas também estão instaladas em `~/Library/Fonts`. **Isso não é opcional**: o
render do Remotion roda num Chrome headless que só encontra a família se ela
estiver instalada no sistema — `@font-face` servido pelo preview não chega lá.
Se você formatar a máquina ou levar o projeto para outro Mac:

```bash
cp ~/gab-edvid/public/fontes/*.ttf ~/Library/Fonts/
```

## Dependências

- `ffmpeg` e `ffprobe` (brew)
- `whisper-cli` (`brew install whisper-cpp`)
- modelo em `models/ggml-large-v3-turbo.bin`
