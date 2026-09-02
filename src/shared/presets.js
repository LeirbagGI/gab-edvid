/**
 * Fonte unica dos estilos da Fase 2.
 *
 * O mesmo objeto alimenta os cards da aba Estilo (no navegador) e os
 * componentes do Remotion (no render). Se um preset muda aqui, muda nos dois —
 * e essa e a razao de o render ser em Remotion e nao em filtro de ffmpeg.
 */

const contorno = (px = 3) => {
  const d = [];
  for (const x of [-px, 0, px]) {
    for (const y of [-px, 0, px]) {
      if (x || y) d.push(`${x}px ${y}px 0 #000`);
    }
  }
  return d.join(',');
};

export const HEADLINES = [
  {
    id: 'branco-arredondado', nome: 'Arredondada',
    amostra: 'É assim que vai\nficar a sua headline',
    estilo: () => ({
      fontFamily: 'Montserrat, Inter, sans-serif', fontWeight: 800,
      color: '#fff', letterSpacing: '-.01em', textShadow: '0 .1em .3em rgba(0,0,0,.85)',
    }),
  },
  {
    id: 'caixa-cinza', nome: 'Caixa',
    amostra: 'É ASSIM QUE VAI\nFICAR A SUA HEADLINE',
    estilo: () => ({
      fontFamily: '"Bebas Neue", Anton, sans-serif', fontWeight: 400,
      color: '#fff', textTransform: 'uppercase', letterSpacing: '.04em',
      background: '#8d97a6', padding: '.28em .55em', borderRadius: '.22em',
    }),
  },
  {
    id: 'contorno', nome: 'Contorno',
    amostra: 'É assim que vai\nficar a sua headline',
    fundoAmostra: '#6d7891',
    estilo: () => ({ fontFamily: 'Poppins, Montserrat, sans-serif', fontWeight: 800,
      color: '#fff', textShadow: contorno(3) }),
  },
  {
    id: 'destaque-cor', nome: 'Destaque',
    amostra: 'É assim que vai\nficar a sua headline',
    // A segunda linha sai na cor de destaque.
    estilo: () => ({ fontFamily: 'Montserrat, Inter, sans-serif',
      fontWeight: 800, color: '#fff' }),
    corSegundaLinha: true,
  },
  {
    id: 'sublinhado', nome: 'Sublinhada',
    amostra: 'É assim que vai\nficar a sua headline',
    estilo: (cor) => ({
      fontFamily: 'Montserrat, Inter, sans-serif', fontWeight: 800, color: '#fff',
      borderBottom: `.14em solid ${cor}`, paddingBottom: '.06em',
    }),
  },
  {
    id: 'caixa-branca', nome: 'Caixa branca',
    amostra: 'É assim que vai\nficar a sua headline',
    estilo: () => ({
      fontFamily: 'Poppins, Montserrat, sans-serif', fontWeight: 800,
      color: '#101010', background: '#fff', padding: '.3em .6em', borderRadius: '.34em',
    }),
  },
];

/**
 * Estilos de legenda.
 *
 * As fontes ficam em public/fontes/ e tambem instaladas no sistema
 * (~/Library/Fonts), porque o render do Remotion roda num Chrome headless que
 * so acha a familia se ela estiver instalada.
 *
 * `janela` = quantas palavras aparecem juntas. `modo`:
 *   frase   — janela de palavras, a que esta soando ganha o estilo `ativo`
 *   palavra — uma palavra por vez, grandona
 *   nenhum  — sem legenda
 */
export const LEGENDAS = [
  {
    id: 'karaoke', nome: 'Karaokê', modo: 'frase', janela: 3,
    amostra: 'É assim que',
    base: () => ({
      fontFamily: 'Montserrat, Inter, sans-serif', fontWeight: 800,
      color: '#fff', textShadow: '0 .12em .3em rgba(0,0,0,.85)',
    }),
    ativo: (cor) => ({ color: cor }),
  },
  {
    id: 'karaoke-caixa', nome: 'Karaokê com caixa', modo: 'frase', janela: 3,
    amostra: 'É assim que',
    base: () => ({
      fontFamily: 'Montserrat, Inter, sans-serif', fontWeight: 800, color: '#fff',
    }),
    // A palavra que soa ganha um bloco na cor de destaque — o estilo mais comum
    // em reel brasileiro.
    ativo: (cor) => ({
      color: '#0d0d0d', background: cor, borderRadius: '.14em',
      padding: '.02em .16em', boxDecorationBreak: 'clone',
    }),
  },
  {
    id: 'contorno', nome: 'Contorno', modo: 'frase', janela: 3,
    amostra: 'sua legenda irá',
    fundoAmostra: '#6d7891',
    base: () => ({
      fontFamily: 'Poppins, Montserrat, sans-serif', fontWeight: 800,
      color: '#fff', textShadow: contorno(3),
    }),
    ativo: (cor) => ({ color: cor }),
  },
  {
    id: 'palavra-unica', nome: 'Palavra única', modo: 'palavra',
    amostra: 'APARECER',
    base: () => ({
      fontFamily: 'Anton, Impact, sans-serif', fontWeight: 400,
      textTransform: 'uppercase', letterSpacing: '.01em',
      color: '#fff', textShadow: contorno(3.5),
    }),
    escala: 1.45,
    ativo: () => ({}),
  },
  {
    id: 'condensada', nome: 'Condensada', modo: 'frase', janela: 4,
    amostra: 'É ASSIM QUE SUA',
    base: () => ({
      fontFamily: '"Bebas Neue", Anton, sans-serif', fontWeight: 400,
      textTransform: 'uppercase', letterSpacing: '.04em',
      color: '#fff', textShadow: '0 .1em .28em rgba(0,0,0,.9)',
    }),
    escala: 1.3,
    ativo: (cor) => ({ color: cor }),
  },
  {
    id: 'cartoon', nome: 'Cartoon', modo: 'palavra',
    amostra: 'APARECER',
    base: () => ({
      fontFamily: '"Luckiest Guy", "Archivo Black", sans-serif', fontWeight: 400,
      textTransform: 'uppercase', letterSpacing: '.02em',
      color: '#fff', textShadow: contorno(4),
    }),
    escala: 1.35,
    ativo: () => ({}),
  },
  {
    id: 'barra', nome: 'Barra sólida', modo: 'frase', janela: 4,
    amostra: 'É assim que sua legenda',
    base: () => ({
      fontFamily: 'Poppins, Montserrat, sans-serif', fontWeight: 700, color: '#fff',
      background: 'rgba(8,8,10,.82)', padding: '.16em .4em', borderRadius: '.18em',
      boxDecorationBreak: 'clone',
    }),
    ativo: (cor) => ({ color: cor }),
  },
  {
    id: 'simples', nome: 'Simples', modo: 'frase', janela: 3,
    amostra: 'É assim que',
    base: () => ({
      fontFamily: 'Inter, -apple-system, sans-serif', fontWeight: 500,
      color: '#fff', textShadow: '0 .1em .25em rgba(0,0,0,.85)',
    }),
    ativo: () => ({}),
  },
  {
    id: 'sem-legenda', nome: 'Sem legenda', modo: 'nenhum',
    amostra: 'sem legenda',
    base: () => ({ color: '#6a7893', fontWeight: 400 }),
    ativo: () => ({}),
  },
];

export const TIPOS_EDICAO = [
  { id: 'limpa', nome: 'Limpa' },
  { id: 'tela-dividida', nome: 'Tela dividida' },      // imagem em cima, video embaixo
  { id: 'tela-dividida-2', nome: 'Tela dividida 2' },  // video em cima, imagem embaixo
];

const svg = (d, cheio) => `<svg width="16" height="16" viewBox="0 0 16 16" `
  + `fill="${cheio ? 'currentColor' : 'none'}" stroke="${cheio ? 'none' : 'currentColor'}" `
  + `stroke-width="1.5">${d}</svg>`;

export const ELEMENTOS = [
  { id: 'movimentoTracking', nome: 'Movimento de tracking',
    ic: svg('<path d="M1.5 5V2.5a1 1 0 011-1H5M11 1.5h2.5a1 1 0 011 1V5M14.5 11v2.5a1 1 0 01-1 1H11M5 14.5H2.5a1 1 0 01-1-1V11"/><circle cx="8" cy="8" r="2.2"/>') },
  { id: 'automacaoZoomIn', nome: 'Automação de zoom in',
    ic: svg('<circle cx="7" cy="7" r="4.6"/><path d="M10.5 10.5L14.5 14.5M5 7h4M7 5v4"/>') },
  { id: 'zoomInOutNosCortes', nome: 'Zoom in e out nos cortes',
    ic: svg('<circle cx="8" cy="8" r="6.2"/><path d="M8 1.8v12.4"/>') },
  { id: 'trilhaSonoraComIA', nome: 'Trilha sonora com IA',
    ic: svg('<path d="M5.5 12V3.5l7-1.2V11"/><circle cx="3.8" cy="12.2" r="1.8"/><circle cx="10.8" cy="11" r="1.8"/>') },
  { id: 'flashNaTransicao', nome: 'Flash na transição',
    ic: svg('<path d="M9 1L3.5 9H7l-.8 6L12.5 7H9z"/>', true) },
];

/**
 * Cores por nome. Existe porque modelo pequeno chuta hex: pedir "amarelo" e
 * receber um laranja. Com a tabela, o nome vira a cor certa sempre.
 */
export const CORES = {
  laranja: '#EE7533', vermelho: '#E5352B', rosa: '#F73D9E', roxo: '#8B6BFF',
  azul: '#2E7BEF', verde: '#25C26E', amarelo: '#F5C518', ciano: '#38D6D2',
  branco: '#FFFFFF', preto: '#111111', dourado: '#D4AF37', lima: '#C2E84D',
  // Modelo costuma responder em ingles mesmo com prompt em portugues.
  orange: '#EE7533', red: '#E5352B', pink: '#F73D9E', purple: '#8B6BFF',
  blue: '#2E7BEF', green: '#25C26E', yellow: '#F5C518', cyan: '#38D6D2',
  white: '#FFFFFF', black: '#111111', gold: '#D4AF37',
};

/** Frase usada nas amostras animadas da aba Estilo. */
export const FRASE_AMOSTRA = 'É assim que sua legenda irá aparecer';

/** Converte um objeto de estilo React em texto CSS, para usar em innerHTML. */
export function cssDe(obj = {}) {
  return Object.entries(obj)
    .map(([k, v]) => `${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}:${v}`)
    .join(';');
}

export const acharHeadline = (id) => HEADLINES.find((h) => h.id === id) || HEADLINES[0];
export const acharLegenda = (id) => LEGENDAS.find((l) => l.id === id) || LEGENDAS[0];
