/**
 * Fonte unica dos estilos da Fase 2.
 *
 * O mesmo objeto alimenta os cards da aba Estilo (no navegador) e os
 * componentes do Remotion (no render). Se um preset muda aqui, muda nos dois —
 * e essa e a razao de o render ser em Remotion e nao em filtro de ffmpeg.
 */

const contorno = (px = 3, cor = '#000') => {
  const d = [];
  for (const x of [-px, 0, px]) {
    for (const y of [-px, 0, px]) {
      if (x || y) d.push(`${x}px ${y}px 0 ${cor}`);
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
 *   acumula — janela de palavras que vao surgindo conforme sao ditas; a que
 *             ainda nao foi dita fica `visibility: hidden` (nao mexe no layout)
 *   nenhum  — sem legenda
 *
 * Campos opcionais, todos com default que reproduz o comportamento de antes:
 *   passado(cor)    — estilo da palavra ja dita dentro da janela (default nenhum)
 *   futuro(cor)     — estilo da palavra que ainda vai soar (default nenhum)
 *   fundoLinha(cor) — estilo do container da linha inteira (faixa, bolha,
 *                     moldura); vira um `inline-block` que huga so o texto
 *   maiusculas      — true aplica `textTransform: uppercase` no container
 *   posicao         — 'baixo' (default, bottom 17%) | 'meio' (centralizada) |
 *                     'alto' (top 30%)
 *
 * Campos do motor (src/shared/legenda-motor.js), so nos 20 estilos novos —
 * os 9 + 5 antigos acima nao tem, e o motor cai em 'nenhuma' pra eles, que e
 * o que reproduz o comportamento de antes:
 *   entrada          — animacao do BLOCO ao entrar: 'nenhuma' | 'pop' | 'sobe' |
 *                       'desfoque' | 'fade'
 *   ativa             — animacao da PALAVRA corrente: 'nenhuma' | 'pop' | 'bounce' |
 *                       'preenche' | 'brilho' | 'tremor' | 'onda' | 'caixa'
 *   destaque(cor)     — estilo extra so da palavra-chave (numero, R$/%, verbo
 *                       de promessa, negacao forte, nome proprio — heuristica
 *                       em src/fase1/corte.js:marcarDestaques)
 *   agrupamento       — { maxPalavras, maxChars } quando difere do default
 *                       do motor (4 palavras, 15 caracteres, 2 linhas)
 *   emoji             — true so no preset `emoji`: acrescenta o emoji do
 *                       bloco (legenda-motor.js:emojiDoBloco) no fim
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

  /* ------------------------------------------------------------------------
   * 5 dos 16 genericos que ficaram (os outros 11 — neon, maquina, pop,
   * caixa-preta, sublinhada, sombra-dura, hormozi/Impacto, discreta, serif,
   * duas-cores, contorno-cor — saem: a pesquisa de mercado (02/09) nao achou
   * referencia real pra eles, e o `hormozi` novo abaixo toma o id de volta
   * com o estilo que o mercado realmente chama assim). Ficam so os que tem
   * efeito visual que os 20 novos nao cobrem.
   * ------------------------------------------------------------------------ */
  {
    id: 'gradiente', nome: 'Gradiente', modo: 'frase', janela: 3,
    amostra: 'É assim que',
    base: (cor) => ({
      fontFamily: 'Montserrat, Inter, sans-serif', fontWeight: 800,
      backgroundImage: `linear-gradient(90deg, ${cor}, #fff)`,
      WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent',
    }),
    ativo: () => ({ color: '#fff' }),
  },
  {
    id: 'bolha', nome: 'Bolha', modo: 'frase', janela: 4,
    amostra: 'É assim que sua',
    base: () => ({ fontFamily: 'Fredoka, Poppins, sans-serif', fontWeight: 700, color: '#111' }),
    fundoLinha: () => ({ background: '#fff', borderRadius: '.5em', padding: '.2em .5em' }),
    ativo: (cor) => ({ color: cor }),
  },
  {
    id: 'fita', nome: 'Fita', modo: 'frase', janela: 4,
    amostra: 'É assim que sua',
    maiusculas: true, escala: 1.2,
    base: () => ({ fontFamily: '"Bebas Neue", Anton, sans-serif', fontWeight: 400, color: '#fff' }),
    fundoLinha: (cor) => ({ background: cor, padding: '.12em .4em' }),
    ativo: () => ({ color: '#111' }),
  },
  {
    id: 'glitch', nome: 'Glitch', modo: 'frase', janela: 3,
    amostra: 'É assim que',
    maiusculas: true,
    base: () => ({
      fontFamily: 'Anton, Impact, sans-serif', fontWeight: 400, color: '#fff',
      textShadow: '-.04em 0 #38D6D2, .04em 0 #F73D9E',
    }),
    ativo: (cor) => ({ color: cor, textShadow: 'none' }),
  },
  {
    id: 'esmaecida', nome: 'Esmaecida', modo: 'frase', janela: 5,
    amostra: 'É assim que sua legenda',
    base: () => ({ fontFamily: 'Montserrat, Inter, sans-serif', fontWeight: 700, color: '#fff' }),
    passado: () => ({ opacity: .45 }),
    futuro: () => ({ opacity: .75 }),
    ativo: (cor) => ({ color: '#fff', opacity: 1, textShadow: contorno(2, cor) }),
  },

  /* ------------------------------------------------------------------------
   * 20 estilos novos — catalogo final da pesquisa de mercado (02/09), tabela
   * completa em ../../../docs/planejamento/legendas-referencia.md. Cada um
   * ganha `entrada` (animacao do bloco) e `ativa` (animacao da palavra
   * corrente), lidos pelo motor em legenda-motor.js — sem eles (os 9 + 5
   * antigos acima), o motor cai em 'nenhuma' e o resultado fica igual ao
   * de antes.
   * ------------------------------------------------------------------------ */
  {
    id: 'hormozi', nome: 'Hormozi', maiusculas: true,
    agrupamento: { maxPalavras: 3 },
    entrada: 'pop', ativa: 'pop',
    base: () => ({
      fontFamily: 'Anton, Impact, sans-serif', fontWeight: 400,
      color: '#fff', textShadow: contorno(4),
    }),
    ativo: () => ({ color: '#FFD700' }),
    destaque: () => ({ color: '#FFD700' }),
  },
  {
    id: 'beast', nome: 'Beast', maiusculas: true, escala: 1.2,
    agrupamento: { maxPalavras: 2 },
    entrada: 'pop', ativa: 'bounce',
    base: () => ({
      fontFamily: 'Anton, Impact, sans-serif', fontWeight: 400,
      color: '#fff', textShadow: contorno(3.5),
    }),
    ativo: () => ({ color: '#FF6600' }),
    destaque: () => ({ color: '#FF6600' }),
  },
  {
    id: 'karaoke-preenche', nome: 'Karaokê preenchida',
    agrupamento: { maxPalavras: 4 },
    entrada: 'nenhuma', ativa: 'preenche',
    base: () => ({
      fontFamily: 'Montserrat, Inter, sans-serif', fontWeight: 800,
      color: '#fff', textShadow: '0 .1em .3em rgba(0,0,0,.85)',
    }),
    ativo: () => ({}),
    destaque: (cor) => ({ color: cor }),
  },
  {
    id: 'caixa-viaja', nome: 'Caixa viajante',
    agrupamento: { maxPalavras: 4 },
    entrada: 'sobe', ativa: 'caixa',
    base: () => ({
      fontFamily: 'Poppins, Montserrat, sans-serif', fontWeight: 700,
      color: '#fff', textShadow: '0 .1em .25em rgba(0,0,0,.8)',
    }),
    ativo: () => ({}),
    destaque: (cor) => ({ color: cor }),
  },
  {
    id: 'pop-palavra', nome: 'Pop palavra a palavra', maiusculas: true, escala: 1.5,
    agrupamento: { maxPalavras: 1 },
    entrada: 'nenhuma', ativa: 'pop',
    base: () => ({
      fontFamily: 'Anton, Impact, sans-serif', fontWeight: 400,
      color: '#fff', textShadow: contorno(3.5),
    }),
    ativo: () => ({}),
    destaque: (cor) => ({ color: cor }),
  },
  {
    id: 'premium', nome: 'Premium',
    agrupamento: { maxPalavras: 4 },
    entrada: 'fade', ativa: 'nenhuma',
    base: () => ({
      fontFamily: 'Inter, -apple-system, sans-serif', fontWeight: 500,
      color: 'rgba(255,255,255,.92)', textShadow: '0 .05em .16em rgba(0,0,0,.5)',
    }),
    ativo: () => ({ color: '#fff' }),
  },
  {
    id: 'peso', nome: 'Peso',
    agrupamento: { maxPalavras: 3 },
    entrada: 'fade', ativa: 'nenhuma',
    base: () => ({ fontFamily: 'Montserrat, Inter, sans-serif', color: '#fff' }),
    passado: () => ({ fontWeight: 300 }),
    futuro: () => ({ fontWeight: 300 }),
    ativo: () => ({ fontWeight: 900 }),
    destaque: () => ({ fontWeight: 700 }),
  },
  {
    id: 'brilho', nome: 'Brilho',
    agrupamento: { maxPalavras: 3 },
    entrada: 'fade', ativa: 'brilho',
    base: () => ({ fontFamily: 'Montserrat, Inter, sans-serif', fontWeight: 800, color: '#fff' }),
    ativo: (cor) => ({ color: cor }),
    destaque: (cor) => ({ color: cor }),
  },
  {
    id: 'sombra-pop', nome: 'Sombra pop', maiusculas: true,
    agrupamento: { maxPalavras: 3 },
    entrada: 'pop', ativa: 'pop',
    base: () => ({
      fontFamily: 'Anton, Impact, sans-serif', fontWeight: 400,
      color: '#fff', textShadow: '.08em .08em 0 #000',
    }),
    ativo: (cor) => ({ color: cor }),
    destaque: (cor) => ({ color: cor }),
  },
  {
    id: 'empilhada', nome: 'Empilhada', maiusculas: true, escala: 1.3,
    // maxChars baixo forca a quebra em 2 linhas quase sempre — a "linha 2
    // inteira na cor" da referencia vira "a palavra ativa entra na cor" aqui:
    // colorir só a segunda linha inteira exigiria o motor saber de linha, não
    // so de palavra, e isso fica de fora do contrato do D1b (ver relatório).
    agrupamento: { maxPalavras: 4, maxChars: 9 },
    entrada: 'sobe', ativa: 'nenhuma',
    base: () => ({ fontFamily: '"Bebas Neue", Anton, sans-serif', fontWeight: 400, color: '#fff' }),
    ativo: (cor) => ({ color: cor }),
    destaque: (cor) => ({ color: cor }),
  },
  {
    id: 'moldura-ouro', nome: 'Moldura dourada',
    agrupamento: { maxPalavras: 4 },
    entrada: 'fade', ativa: 'nenhuma',
    base: () => ({
      fontFamily: '"Playfair Display", Georgia, serif', fontWeight: 700, fontStyle: 'italic',
      color: '#fff',
    }),
    ativo: () => ({ color: '#D4AF37' }),
    destaque: () => ({ color: '#D4AF37' }),
    fundoLinha: () => ({ border: '.06em solid #D4AF37', borderRadius: '.3em', padding: '.25em .6em' }),
  },
  {
    id: 'primo', nome: 'Números em destaque', maiusculas: true,
    agrupamento: { maxPalavras: 4 },
    entrada: 'pop', ativa: 'nenhuma',
    base: () => ({
      fontFamily: 'Montserrat, Inter, sans-serif', fontWeight: 800,
      color: '#fff', textShadow: contorno(3),
    }),
    ativo: () => ({}),
    destaque: () => ({ color: '#F5C518', display: 'inline-block', transform: 'scale(1.1)' }),
  },
  {
    id: 'podcast', nome: 'Corte de podcast',
    agrupamento: { maxPalavras: 4 },
    entrada: 'fade', ativa: 'nenhuma',
    base: () => ({
      fontFamily: 'Montserrat, Inter, sans-serif', fontWeight: 700,
      color: '#fff', textShadow: contorno(2.5),
    }),
    ativo: (cor) => ({ color: cor }),
    destaque: (cor) => ({ color: cor }),
  },
  {
    id: 'dark-venda', nome: 'Venda',
    agrupamento: { maxPalavras: 3 },
    entrada: 'sobe', ativa: 'nenhuma',
    base: () => ({ fontFamily: 'Poppins, Montserrat, sans-serif', fontWeight: 800, color: '#fff' }),
    ativo: () => ({ color: '#D4AF37' }),
    destaque: () => ({ color: '#D4AF37' }),
    fundoLinha: () => ({ background: 'rgba(10,10,10,.75)', padding: '.2em .5em', borderRadius: '.16em' }),
  },
  {
    id: 'emoji', nome: 'Emoji', emoji: true,
    agrupamento: { maxPalavras: 3 },
    entrada: 'pop', ativa: 'pop',
    base: () => ({
      fontFamily: 'Montserrat, Inter, sans-serif', fontWeight: 700,
      color: '#fff', textShadow: contorno(2.5),
    }),
    ativo: (cor) => ({ color: cor }),
    destaque: (cor) => ({ color: cor }),
  },
  {
    id: 'onda', nome: 'Onda',
    agrupamento: { maxPalavras: 3 },
    entrada: 'fade', ativa: 'onda',
    base: () => ({ fontFamily: 'Montserrat, Inter, sans-serif', fontWeight: 800, color: '#fff' }),
    ativo: (cor) => ({ color: cor }),
    destaque: (cor) => ({ color: cor }),
  },
  {
    id: 'desfoque', nome: 'Desfoque',
    agrupamento: { maxPalavras: 3 },
    entrada: 'desfoque', ativa: 'nenhuma',
    base: () => ({
      fontFamily: 'Inter, -apple-system, sans-serif', fontWeight: 800,
      color: '#fff', textShadow: '0 .08em .22em rgba(0,0,0,.6)',
    }),
    ativo: (cor) => ({ color: cor }),
    destaque: (cor) => ({ color: cor }),
  },
  {
    id: 'tremor', nome: 'Tremor', maiusculas: true,
    agrupamento: { maxPalavras: 3 },
    entrada: 'pop', ativa: 'tremor',
    base: () => ({
      fontFamily: 'Anton, Impact, sans-serif', fontWeight: 400,
      color: '#fff', textShadow: contorno(3),
    }),
    ativo: (cor) => ({ color: cor }),
    destaque: (cor) => ({ color: cor }),
  },
  {
    id: 'contorno-vivo', nome: 'Contorno vivo',
    agrupamento: { maxPalavras: 3 },
    entrada: 'nenhuma', ativa: 'nenhuma',
    // `WebkitTextStroke` fino (nao a pilha de text-shadow do helper `contorno`,
    // grossa demais pra virar um contorno oco — em texto transparente ela so
    // enche a letra) e o jeito certo de um contorno oco de verdade.
    base: (cor) => ({
      fontFamily: 'Poppins, Montserrat, sans-serif', fontWeight: 800,
      color: 'transparent', WebkitTextStroke: `1.5px ${cor}`,
    }),
    ativo: () => ({ color: '#fff', WebkitTextStroke: '0' }),
    destaque: (cor) => ({ color: cor, WebkitTextStroke: '0' }),
  },
  {
    id: 'marcal', nome: 'Impacto total', maiusculas: true, escala: 1.35,
    agrupamento: { maxPalavras: 2 },
    entrada: 'pop', ativa: 'pop',
    base: () => ({
      fontFamily: 'Anton, Impact, sans-serif', fontWeight: 400, color: '#fff',
      textShadow: `${contorno(5)}, .1em .1em .12em rgba(0,0,0,.6)`,
    }),
    ativo: () => ({ color: '#E5352B' }),
    destaque: () => ({ color: '#E5352B' }),
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
