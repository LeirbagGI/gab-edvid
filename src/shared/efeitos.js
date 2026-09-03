/**
 * Fonte unica das transicoes, efeitos e intro da Fase 2.
 *
 * Catalogo puro, sem `node:` — igual a `presets.js` e `cor.js`, porque um dia
 * pode alimentar tanto o servidor (Reel.jsx no render) quanto a interface (aba
 * Estilo, cards de transicao/efeito), do jeito que `presets.js` ja faz para
 * headline e legenda.
 */

/**
 * Transicoes entre clipes. `duracao` em segundos, a janela fica centrada no
 * corte: comeca em `clipe.inicio - duracao/2` e termina em `clipe.inicio +
 * duracao/2`. `corte` tem duracao 0 — sem sobreposicao, sem janela.
 */
export const TRANSICOES = [
  { id: 'corte', nome: 'Corte seco', duracao: 0,
    descricao: 'Sem transicao — o corte de hoje, direto.' },
  { id: 'crossfade', nome: 'Crossfade', duracao: 0.4,
    descricao: 'O clipe velho dissolve enquanto o novo aparece.' },
  { id: 'dip-preto', nome: 'Dip para preto', duracao: 0.3,
    descricao: 'Escurece ate o preto e clareia de volta no clipe novo.' },
  { id: 'dip-branco', nome: 'Dip para branco', duracao: 0.3,
    descricao: 'Clareia ate o branco e escurece de volta no clipe novo.' },
  { id: 'flash', nome: 'Flash', duracao: 0.13,
    descricao: 'Clarao branco curto sobre o clipe novo — a transicao de hoje.' },
  { id: 'zoom-punch', nome: 'Zoom punch', duracao: 0.3,
    descricao: 'O clipe novo entra em 1,25x e assenta em 1x com um leve estouro (back-out).' },
  { id: 'whip-esquerda', nome: 'Whip pan esquerda', duracao: 0.25,
    descricao: 'O clipe velho sai deslizando para a esquerda com blur de movimento; o novo entra pelo mesmo lado.' },
  { id: 'whip-direita', nome: 'Whip pan direita', duracao: 0.25,
    descricao: 'O clipe velho sai deslizando para a direita com blur de movimento; o novo entra pelo mesmo lado.' },
  { id: 'slide-cima', nome: 'Slide para cima', duracao: 0.3,
    descricao: 'O clipe velho sobe e sai; o novo entra por baixo.' },
  { id: 'slide-baixo', nome: 'Slide para baixo', duracao: 0.3,
    descricao: 'O clipe velho desce e sai; o novo entra por cima.' },
  { id: 'blur', nome: 'Blur', duracao: 0.4,
    descricao: 'O clipe velho desfoca e some; o novo entra nitido.' },
  { id: 'glitch', nome: 'Glitch', duracao: 0.2,
    descricao: 'Tres fatias horizontais deslocadas com canais RGB separados, tipico de falha de sinal.' },
];

/**
 * Efeitos por projeto (`estilo.efeitos`) e por clipe (`fase1.clipes[].efeitos`,
 * sobrescreve o do projeto durante aquele clipe). `escopo` diz onde o efeito
 * nasce por natureza — `congelar` so faz sentido por clipe. `parametros`
 * documenta a faixa do controle principal (a UI usa isso para desenhar o
 * slider); efeitos on/off (`blur-fundo`, `letterbox`) usam a mesma faixa como
 * "0 desligado, 1 ligado", o schema real de cada um esta em data-models.md.
 */
export const EFEITOS = [
  { id: 'grao', nome: 'Grão de filme', escopo: 'projeto',
    parametros: { intensidade: [0, 1] },
    descricao: 'Ruído de filme (feTurbulence) por cima do vídeo.' },
  { id: 'vinheta', nome: 'Vinheta', escopo: 'projeto',
    parametros: { intensidade: [0, 1] },
    descricao: 'Escurece as bordas em gradiente radial.' },
  { id: 'shake', nome: 'Tremor de câmera', escopo: 'projeto',
    parametros: { intensidade: [0, 1] },
    descricao: 'Translação com ruído senoidal de baixa frequência, tipo mão segurando a câmera.' },
  { id: 'blur-fundo', nome: 'Blur de fundo', escopo: 'projeto',
    parametros: { intensidade: [0, 1] },
    descricao: 'Para bruto horizontal: cópia desfocada e ampliada atrás, vídeo original centralizado sem corte.' },
  { id: 'barra-progresso', nome: 'Barra de progresso', escopo: 'projeto',
    parametros: { intensidade: [0, 1] },
    descricao: 'Linha na cor de destaque, no topo ou na base, que cresce com o tempo do vídeo.' },
  { id: 'letterbox', nome: 'Letterbox', escopo: 'projeto',
    parametros: { intensidade: [0, 1] },
    descricao: 'Barras pretas em cima e embaixo, proporção 2,35:1.' },
  { id: 'congelar', nome: 'Congelar quadro', escopo: 'clipe',
    parametros: { intensidade: [0, 1] },
    descricao: 'Estende o clipe com o último quadro parado por N segundos — útil para CTA. '
      + 'O áudio da Fase 1 não é estendido (fica mudo no trecho congelado).' },
];

/**
 * Intro opcional antes do primeiro clipe. Imagem anima (zoom lento, fade ou
 * slide) por `duracao` segundos; vídeo usa a própria duração de origem —
 * quem define `duracao` no `projeto.json` é quem cria a intro, o Reel só lê.
 */
export const INTRO_PADRAO = { duracao: 2.5, animacao: 'zoom-lento' };
export const ANIMACOES_INTRO = ['zoom-lento', 'fade', 'slide'];

export const acharTransicao = (id) => TRANSICOES.find((t) => t.id === id) || TRANSICOES[0];
export const acharEfeito = (id) => EFEITOS.find((e) => e.id === id) || null;

/**
 * Transicao global efetiva a partir do `estilo` do projeto. Compatibilidade:
 * `elementos.flashNaTransicao: true` sem `estilo.transicao` equivale a
 * `{ tipo: 'flash' }`; ausencia total equivale a `corte`.
 */
export function transicaoPadrao(estilo) {
  const est = estilo || {};
  if (est.transicao?.tipo) {
    const def = acharTransicao(est.transicao.tipo);
    return { tipo: def.id, duracao: est.transicao.duracao ?? def.duracao };
  }
  if (est.elementos?.flashNaTransicao) {
    const def = acharTransicao('flash');
    return { tipo: def.id, duracao: def.duracao };
  }
  const corte = acharTransicao('corte');
  return { tipo: corte.id, duracao: corte.duracao };
}

/** Efeitos de projeto quando nenhum foi ligado — objeto vazio, tudo desligado. */
export function efeitosPadrao() {
  return {};
}

/* ------------------------------------------------------------ grao (H3) ---
 * O grao original (Efeitos.jsx) desenhava um filtro SVG `feTurbulence` por
 * quadro — o Chromium precisa rasterizar ruido fractal de novo a cada quadro
 * do render, e isso sozinho quase dobrou o tempo do cenario mais pesado
 * (medido em docs/implementacao/h3-render.md). A troca: uma textura de ruido
 * PNG 256×256 gerada UMA VEZ (aqui, na carga do modulo) como data URI, usada
 * como `backgroundImage` com `mixBlendMode: 'overlay'` — o Chromium decodifica
 * o PNG uma vez e so recompoe (barato) a cada quadro. `deslocamentoGrao`
 * desloca o `backgroundPosition` por quadro (determinístico, sem
 * Math.random em tempo de render) para o ruido nao ficar parado na tela.
 *
 * Este modulo nao pode importar `node:*` (roda tanto no bundle do Remotion —
 * navegador — quanto no server), entao o PNG e montado a mao: cabecalho +
 * IHDR (grayscale 8-bit) + IDAT com deflate "stored" (sem compressao — nao
 * ha zlib disponivel sem `node:`) + IEND, com CRC32/Adler32 calculados aqui
 * mesmo. Continua pequeno (~65 KB antes do base64) por ser 256×256 em tons
 * de cinza, 1 byte por pixel.
 * -------------------------------------------------------------------- */

const GRAO_LADO = 256;

function concatUint8(partes) {
  const tamanho = partes.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(tamanho);
  let offset = 0;
  for (const p of partes) { out.set(p, offset); offset += p.length; }
  return out;
}

let tabelaCrc32 = null;
function crc32(bytes) {
  if (!tabelaCrc32) {
    tabelaCrc32 = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      tabelaCrc32[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = tabelaCrc32[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function adler32(bytes) {
  let a = 1;
  let b = 0;
  const MOD = 65521;
  for (let i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]) % MOD;
    b = (b + a) % MOD;
  }
  return ((b << 16) | a) >>> 0;
}

/** Deflate so com blocos "stored" (BTYPE=00) — sem compressao, mas 100% valido. */
function deflateArmazenado(dados) {
  const MAX = 65535;
  const blocos = [];
  let offset = 0;
  do {
    const fim = Math.min(offset + MAX, dados.length);
    const tamanho = fim - offset;
    const final = fim >= dados.length ? 1 : 0;
    const len = tamanho;
    const nlen = (~len) & 0xffff;
    blocos.push(new Uint8Array([
      final, len & 0xff, (len >> 8) & 0xff, nlen & 0xff, (nlen >> 8) & 0xff,
    ]));
    blocos.push(dados.subarray(offset, fim));
    offset = fim;
  } while (offset < dados.length);
  return concatUint8(blocos);
}

function zlibArmazenado(dados) {
  const cabecalho = new Uint8Array([0x78, 0x01]); // deflate, janela 32K, nivel rapido
  const corpo = deflateArmazenado(dados);
  const chk = adler32(dados);
  const chkBytes = new Uint8Array([(chk >>> 24) & 0xff, (chk >>> 16) & 0xff, (chk >>> 8) & 0xff, chk & 0xff]);
  return concatUint8([cabecalho, corpo, chkBytes]);
}

function paraBytesAscii(str) {
  const arr = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) arr[i] = str.charCodeAt(i);
  return arr;
}

function pngChunk(tipo, dados) {
  const tipoBytes = paraBytesAscii(tipo);
  const n = dados.length;
  const tamanho = new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
  const crc = crc32(concatUint8([tipoBytes, dados]));
  const crcBytes = new Uint8Array([(crc >>> 24) & 0xff, (crc >>> 16) & 0xff, (crc >>> 8) & 0xff, crc & 0xff]);
  return concatUint8([tamanho, tipoBytes, dados, crcBytes]);
}

const BASE64_ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function paraBase64(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const temB1 = i + 1 < bytes.length;
    const temB2 = i + 2 < bytes.length;
    const b1 = temB1 ? bytes[i + 1] : 0;
    const b2 = temB2 ? bytes[i + 2] : 0;
    out += BASE64_ALFABETO[b0 >> 2];
    out += BASE64_ALFABETO[((b0 & 3) << 4) | (b1 >> 4)];
    out += temB1 ? BASE64_ALFABETO[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    out += temB2 ? BASE64_ALFABETO[b2 & 63] : '=';
  }
  return out;
}

/** PRNG determinístico (mulberry32) — mesma textura toda vez que o processo sobe. */
function criarPRNG(seed) {
  let a = seed >>> 0;
  return function proximo() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function construirTexturaGrao(lado = GRAO_LADO) {
  const rng = criarPRNG(0x9e3779b9);
  const linhas = [];
  for (let y = 0; y < lado; y++) {
    // +1: byte de filtro (0 = None) no inicio de cada scanline, exigido pelo PNG.
    const linha = new Uint8Array(lado + 1);
    linha[0] = 0;
    for (let x = 0; x < lado; x++) {
      // Ruido em torno do cinza medio (128): overlay escurece abaixo, clareia acima.
      const v = 128 + Math.round((rng() - 0.5) * 150);
      linha[x + 1] = Math.max(0, Math.min(255, v));
    }
    linhas.push(linha);
  }
  const bruto = concatUint8(linhas);
  const idatData = zlibArmazenado(bruto);

  const assinatura = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrData = new Uint8Array(13);
  ihdrData[0] = (lado >>> 24) & 0xff; ihdrData[1] = (lado >>> 16) & 0xff;
  ihdrData[2] = (lado >>> 8) & 0xff; ihdrData[3] = lado & 0xff;
  ihdrData[4] = (lado >>> 24) & 0xff; ihdrData[5] = (lado >>> 16) & 0xff;
  ihdrData[6] = (lado >>> 8) & 0xff; ihdrData[7] = lado & 0xff;
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 0; // color type: grayscale
  ihdrData[10] = 0; ihdrData[11] = 0; ihdrData[12] = 0;

  const png = concatUint8([
    assinatura,
    pngChunk('IHDR', ihdrData),
    pngChunk('IDAT', idatData),
    pngChunk('IEND', new Uint8Array(0)),
  ]);
  return `data:image/png;base64,${paraBase64(png)}`;
}

/**
 * Textura de grao — gerada uma unica vez quando este modulo carrega (mesmo
 * custo de sempre, pago uma vez por processo, nao por quadro).
 */
export const TEXTURA_GRAO = construirTexturaGrao();

/**
 * Deslocamento pseudoaleatorio (determinístico) do `backgroundPosition` da
 * textura de grao por quadro, para o ruido "vibrar" sem ficar estatico.
 * Muda a cada 2 quadros (~15x/s em 30fps) — rapido o bastante para nao
 * parecer parado, devagar o bastante para nao virar strobe.
 */
export function deslocamentoGrao(frame, lado = GRAO_LADO) {
  const passo = Math.floor(frame / 2);
  const rx = Math.abs(Math.sin(passo * 12.9898));
  const ry = Math.abs(Math.sin(passo * 78.233 + 4.1));
  return {
    x: Math.floor((rx % 1) * lado),
    y: Math.floor((ry % 1) * lado),
  };
}
