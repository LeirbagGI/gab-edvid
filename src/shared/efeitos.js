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
