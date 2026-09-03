/**
 * Motor de animacao de legenda.
 *
 * Modulo puro (sem `node:`, sem `setTimeout`): tudo aqui e funcao do tempo
 * (`t`/`dt` em segundos), porque o mesmo codigo roda no Remotion (por quadro)
 * e no card da aba Estilo (por `requestAnimationFrame`) — o card so e igual
 * ao video "por construcao" se os dois usarem exatamente as mesmas contas.
 *
 * Contrato completo em ../../../docs/planejamento/legendas-referencia.md.
 */

/* ------------------------------------------------------------- easings */

export const easings = {
  linear: (p) => p,
  easeOut: (p) => 1 - (1 - p) ** 3,
  easeInOut: (p) => (p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2),
  // back-out classico (overshoot), c1 = 1.70158 — o mesmo valor que Opus/Veed usam no pop.
  backOut: (p) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    const x = p - 1;
    return 1 + c3 * x ** 3 + c1 * x ** 2;
  },
};

const clamp01 = (v) => Math.min(1, Math.max(0, v));

/**
 * interpolar(t, entradas, saidas, easing) — igual ao `interpolate` do
 * Remotion: mapeia `t` de um segmento de `entradas` para o segmento
 * correspondente de `saidas`, com o easing aplicado ao progresso local.
 * Aceita mais de dois pontos (usado no bounce, que tem picos no meio).
 * Fora do intervalo, extrapola com clamp (segura no primeiro/ultimo valor).
 */
export function interpolar(t, entradas, saidas, easing = 'linear') {
  if (entradas.length !== saidas.length || entradas.length < 2) {
    throw new Error('interpolar: entradas e saidas precisam do mesmo tamanho, com 2+ pontos');
  }
  if (t <= entradas[0]) return saidas[0];
  if (t >= entradas.at(-1)) return saidas.at(-1);

  const fn = easings[easing] || easings.linear;
  for (let i = 0; i < entradas.length - 1; i++) {
    const a = entradas[i];
    const b = entradas[i + 1];
    if (t >= a && t <= b) {
      const p = b === a ? 1 : (t - a) / (b - a);
      return saidas[i] + (saidas[i + 1] - saidas[i]) * fn(p);
    }
  }
  return saidas.at(-1);
}

/* ------------------------------------------------------- agrupamento */

/**
 * Tenta quebrar `textos` (array de string) em ate `maxLinhas` linhas de ate
 * `maxChars` cada, sem quebrar palavra. Devolve `[[idx...], ...]` (indices
 * relativos a `textos`) ou `null` se nao coube.
 */
function calcularLinhas(textos, maxChars, maxLinhas) {
  const linhas = [[]];
  let atual = '';
  for (let i = 0; i < textos.length; i++) {
    const tentativa = atual ? `${atual} ${textos[i]}` : textos[i];
    if (!atual || tentativa.length <= maxChars) {
      linhas.at(-1).push(i);
      atual = tentativa;
    } else {
      if (linhas.length >= maxLinhas) return null;
      linhas.push([i]);
      atual = textos[i];
    }
  }
  return linhas;
}

/**
 * Quebra `palavras` (com `{ texto, inicio, fim, destaque? }`) em blocos de
 * legenda. Quebra por pontuacao final, por virgula (com o bloco ja com 2+
 * palavras), por pausa entre palavras > `pausaMax`, por `maxPalavras`, e por
 * comprimento (uma linha tem ate `maxChars`, no maximo `maxLinhas`).
 */
export function agruparBlocos(palavras, {
  maxPalavras = 4, maxLinhas = 2, maxChars = 15, pausaMax = 0.6,
} = {}) {
  const blocos = [];
  let atual = [];

  const fechar = () => {
    if (!atual.length) return;
    const linhas = calcularLinhas(atual.map((p) => p.texto), maxChars, maxLinhas)
      || atual.map((_, i) => [i]);
    blocos.push({
      inicio: atual[0].inicio,
      fim: atual.at(-1).fim,
      palavras: atual.map((p) => ({
        texto: p.texto, inicio: p.inicio, fim: p.fim, destaque: !!p.destaque,
      })),
      linhas,
    });
    atual = [];
  };

  for (const p of palavras) {
    if (atual.length) {
      const anterior = atual.at(-1);
      const gap = p.inicio - anterior.fim;
      const fechouFrase = /[.!?]$/.test(anterior.texto);
      const fechouVirgula = /,$/.test(anterior.texto) && atual.length >= 2;
      const estourouPalavras = atual.length >= maxPalavras;
      const estourouPausa = gap > pausaMax;
      const cabe = calcularLinhas([...atual.map((w) => w.texto), p.texto], maxChars, maxLinhas) !== null;

      if (fechouFrase || fechouVirgula || estourouPalavras || estourouPausa || !cabe) fechar();
    }
    atual.push(p);
  }
  fechar();

  return blocos;
}

/**
 * Agrupamento default de um preset: novos usam `preset.agrupamento` (ou o
 * padrao de 4 palavras / 15 caracteres); os 9 presets antigos (com `modo`)
 * mantem a janela fixa de antes e nunca quebram por comprimento — e assim
 * que o card da aba Estilo continua igual ao que era.
 */
export function agrupamentoDoPreset(preset) {
  const legado = preset.modo !== undefined;
  const maxPalavras = preset.agrupamento?.maxPalavras
    ?? (legado ? (preset.modo === 'palavra' ? 1 : (preset.janela || 4)) : 4);
  const maxChars = preset.agrupamento?.maxChars ?? (legado ? Infinity : 15);
  return { maxPalavras, maxChars };
}

/* ------------------------------------------------------------- estado */

/**
 * Estado da legenda no instante `t`: qual bloco, qual palavra dentro dele
 * esta ativa, e o progresso de cada animacao. `t` recebe `antecedencia`
 * antes de procurar (a palavra acende um pouco antes do audio). Se a
 * distancia ate a proxima palavra passar de `silencio`, devolve `null` (a
 * legenda some).
 */
export function estadoEm(blocos, t, { antecedencia = 0.12, silencio = 1.0 } = {}) {
  const tt = t + antecedencia;
  const bloco = blocos.find((b) => tt >= b.inicio && tt <= b.fim + 0.15);
  if (!bloco) return null;

  const { palavras } = bloco;
  let indiceAtiva = palavras.findIndex((w) => tt >= w.inicio && tt < w.fim);

  if (indiceAtiva === -1) {
    // tt caiu num vao dentro do bloco: antes da proxima palavra comecar
    // (silencio interno) ou depois da ultima (folga de 0.15s do bloco).
    const prox = palavras.find((w) => tt < w.inicio);
    if (prox) {
      const distancia = prox.inicio - tt;
      if (distancia > silencio) return null;
      indiceAtiva = palavras.indexOf(prox);
    } else {
      indiceAtiva = palavras.length - 1;
    }
  }

  const palavraAtiva = palavras[indiceAtiva];
  const duracao = Math.max(0.001, palavraAtiva.fim - palavraAtiva.inicio);
  const dtPalavra = Math.max(0, tt - palavraAtiva.inicio);
  const progressoPalavra = clamp01((tt - palavraAtiva.inicio) / duracao);
  const dtBloco = tt - bloco.inicio;

  return {
    bloco, dtBloco, indiceAtiva, dtPalavra, progressoPalavra,
  };
}

/* -------------------------------------------------------- entrada do bloco */

/** Estilo (React/CSS) da entrada do bloco na tela, funcao de `dtBloco`. */
export function estiloBloco(preset, { dtBloco = 0, cor } = {}) {
  const entrada = preset?.entrada || 'nenhuma';
  const dt = Math.max(0, dtBloco);

  switch (entrada) {
    case 'pop': {
      const dur = 0.2;
      let escala;
      if (dt <= dur / 2) escala = interpolar(dt, [0, dur / 2], [0.8, 1.15], 'easeOut');
      else if (dt < dur) escala = interpolar(dt, [dur / 2, dur], [1.15, 1], 'easeOut');
      else escala = 1;
      return { opacity: 1, transform: `scale(${escala.toFixed(4)})` };
    }
    case 'sobe': {
      const dur = 0.35;
      const p = Math.min(1, dt / dur);
      const y = interpolar(p, [0, 1], [20, 0], 'easeOut');
      const op = interpolar(p, [0, 1], [0, 1], 'easeOut');
      return { opacity: Number(op.toFixed(4)), transform: `translateY(${y.toFixed(2)}px)` };
    }
    case 'desfoque': {
      const dur = 0.3;
      const p = Math.min(1, dt / dur);
      const blur = interpolar(p, [0, 1], [10, 0], 'easeOut');
      const op = interpolar(p, [0, 1], [0, 1], 'easeOut');
      return { opacity: Number(op.toFixed(4)), filter: `blur(${blur.toFixed(2)}px)` };
    }
    case 'fade': {
      const dur = 0.3;
      const p = Math.min(1, dt / dur);
      return { opacity: Number(interpolar(p, [0, 1], [0, 1], 'easeOut').toFixed(4)) };
    }
    default:
      return { opacity: 1 };
  }
}

/* --------------------------------------------------------- palavra ativa */

const hexParaRgb = (hex) => {
  const h = String(hex).replace('#', '');
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const num = parseInt(n, 16) || 0;
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
};

const misturarCor = (a, b, t) => {
  const pa = hexParaRgb(a);
  const pb = hexParaRgb(b);
  const p = clamp01(t);
  const r = Math.round(pa.r + (pb.r - pa.r) * p);
  const g = Math.round(pa.g + (pb.g - pa.g) * p);
  const bl = Math.round(pa.b + (pb.b - pa.b) * p);
  return `rgb(${r},${g},${bl})`;
};

function animarPalavraAtiva(tipo, preset, {
  dtPalavra = 0, progresso = 0, cor, indiceLetra,
} = {}) {
  const dt = Math.max(0, dtPalavra);

  switch (tipo) {
    case 'pop': {
      const dur = 0.2;
      let escala;
      if (dt <= dur / 2) escala = interpolar(dt, [0, dur / 2], [0.8, 1.15], 'easeOut');
      else if (dt < dur) escala = interpolar(dt, [dur / 2, dur], [1.15, 1], 'easeOut');
      else escala = 1;
      return { display: 'inline-block', transform: `scale(${escala.toFixed(4)})` };
    }
    case 'bounce': {
      const dur = 0.35;
      const tempos = [0, 0.25, 0.5, 0.75, 1].map((f) => f * dur);
      const y = interpolar(dt, tempos, [0, -20, 0, -10, 0], 'easeInOut');
      return { display: 'inline-block', transform: `translateY(${y.toFixed(2)}px)` };
    }
    case 'preenche': {
      // Preenchimento karaoke num elemento so: a cor de destaque vai de 0 a
      // P%, a cor base do proprio preset continua de P% a 100% — sem
      // precisar de uma segunda camada por baixo.
      const p = Math.round(clamp01(progresso) * 1000) / 10;
      const corBase = (preset?.base && preset.base(cor)?.color) || '#fff';
      return {
        backgroundImage: `linear-gradient(90deg, ${cor} 0%, ${cor} ${p}%, ${corBase} ${p}%, ${corBase} 100%)`,
        WebkitBackgroundClip: 'text',
        backgroundClip: 'text',
        color: 'transparent',
      };
    }
    case 'brilho': {
      const dur = 0.8;
      const ciclo = ((dt % dur) + dur) % dur;
      const raio = interpolar(ciclo, [0, dur / 2, dur], [10, 20, 10], 'easeInOut');
      return { textShadow: `0 0 ${raio.toFixed(1)}px ${cor}, 0 0 ${(raio * 1.6).toFixed(1)}px ${cor}` };
    }
    case 'tremor': {
      const dur = 0.12;
      let x = 0;
      if (dt < dur) {
        const freq = 3;
        x = 3 * Math.sin((dt / dur) * Math.PI * 2 * freq) * (1 - dt / dur);
      }
      return { display: 'inline-block', transform: `translateX(${x.toFixed(2)}px)` };
    }
    case 'onda': {
      const atraso = (indiceLetra || 0) * 0.06;
      const tLocal = Math.max(0, dt - atraso);
      const dur = 0.8;
      const fase = (tLocal % dur) / dur;
      const y = interpolar(fase, [0, 0.5, 1], [0, -10, 0], 'easeInOut');
      const corLetra = misturarCor(cor, '#ffffff', Math.abs(fase - 0.5) * 2);
      return { display: 'inline-block', transform: `translateY(${y.toFixed(2)}px)`, color: corLetra };
    }
    case 'caixa': {
      const dur = 0.15;
      const p = Math.min(1, dt / dur);
      const escala = interpolar(p, [0, 1], [0.95, 1], 'easeOut');
      return {
        display: 'inline-block', backgroundColor: cor, color: '#0d0d0d',
        borderRadius: '.18em', padding: '.02em .16em', boxDecorationBreak: 'clone',
        transform: `scale(${escala.toFixed(3)})`,
      };
    }
    default:
      return {};
  }
}

/**
 * Estilo (React/CSS) de uma palavra: combina `base()`, `passado()`/`futuro()`
 * conforme `estado`, `ativo(cor)` quando `estado: 'ativa'`, `destaque(cor)`
 * quando a palavra e palavra-chave, e por cima a animacao de `preset.ativa`
 * (so quando `estado: 'ativa'`). A animacao vai por ultimo de proposito: se
 * uma palavra e destaque E esta ativa, a animacao (ex. o preenchimento do
 * karaoke) continua valendo.
 */
export function estiloPalavra(preset, {
  estado = 'futura', destaque = false, dtPalavra = 0, progresso = 0, cor, indiceLetra,
} = {}) {
  const base = preset.base ? preset.base(cor) : {};

  let estiloEstado = {};
  if (estado === 'passada') estiloEstado = preset.passado ? preset.passado(cor) : {};
  else if (estado === 'futura') estiloEstado = preset.futuro ? preset.futuro(cor) : {};
  else if (estado === 'ativa') estiloEstado = preset.ativo ? preset.ativo(cor) : {};

  const estiloDestaque = (destaque && preset.destaque) ? preset.destaque(cor) : {};

  const anim = estado === 'ativa'
    ? animarPalavraAtiva(preset.ativa || 'nenhuma', preset, {
      dtPalavra, progresso, cor, indiceLetra,
    })
    : {};

  return { ...base, ...estiloEstado, ...estiloDestaque, ...anim };
}

/* --------------------------------------------------------------- emoji */

const EMOJI_REGRAS = [
  { re: /(dinheiro|faturar|faturamento|lucro|lucrar|r\$)/i, emoji: '💰' },
  { re: /(atenç[aã]o|atencao|cuidado|erro)/i, emoji: '⚠️' },
  { re: /(resultado|pronto|certo)/i, emoji: '✅' },
  { re: /(crescer|crescimento|escalar|explodir)/i, emoji: '🚀' },
  { re: /(fogo|quente|top)/i, emoji: '🔥' },
];

/** Emoji do bloco (no maximo um), pela primeira palavra-gatilho que aparecer. */
export function emojiDoBloco(bloco) {
  if (!bloco?.palavras?.length) return null;
  const texto = bloco.palavras.map((p) => p.texto).join(' ');
  for (const regra of EMOJI_REGRAS) {
    if (regra.re.test(texto)) return regra.emoji;
  }
  return null;
}
