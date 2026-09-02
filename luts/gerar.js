import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Gera as 12 LUTs .cube da Fase 1 (F1) a partir de formulas matematicas
 * simples — nada baixado, nada com licenca de terceiro. Cada LUT e uma
 * funcao pura sobre (r,g,b) em 0..1, amostrada numa grade LUT_3D_SIZE 17
 * (17^3 = 4913 pontos), no formato Adobe/Resolve que o filtro `lut3d` do
 * ffmpeg le direto.
 *
 * Rodar de novo depois de mexer numa formula: `node luts/gerar.js`.
 */

const TAMANHO = 17;
const aqui = path.dirname(fileURLToPath(import.meta.url));

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const luminancia = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

/** Curva S classica: escurece sombra, clareia luz, mais forte no meio. `k` >= 1. */
function curvaS(x, k) {
  return x < 0.5
    ? 0.5 * (2 * x) ** k
    : 1 - 0.5 * (2 * (1 - x)) ** k;
}

/** Aplica a mesma curva de contraste nos tres canais. */
function contraste(k) {
  return (r, g, b) => [curvaS(r, k), curvaS(g, k), curvaS(b, k)];
}

/** Satura/dessatura em torno da luminancia (fator 1 = neutro, 0 = P&B). */
function saturar(fator) {
  return (r, g, b) => {
    const l = luminancia(r, g, b);
    return [
      l + (r - l) * fator,
      l + (g - l) * fator,
      l + (b - l) * fator,
    ];
  };
}

/** Compoe duas transformacoes: aplica `a`, depois `b` no resultado. */
function encadear(...fns) {
  return (r, g, b) => fns.reduce(([rr, gg, bb], fn) => fn(rr, gg, bb), [r, g, b]);
}

const LUTS = [
  {
    id: 'neutro',
    titulo: 'Neutro (identidade)',
    formula: 'out = in — grade de referencia, sem alteracao nenhuma.',
    transformar: (r, g, b) => [r, g, b],
  },
  {
    id: 'quente',
    titulo: 'Quente (ganho no R, corte leve no B)',
    formula: 'R = R*1.12 + 0.02 · B = B*0.90',
    transformar: (r, g, b) => [r * 1.12 + 0.02, g, b * 0.90],
  },
  {
    id: 'frio',
    titulo: 'Frio (inverso da Quente)',
    formula: 'R = R*0.90 · B = B*1.12 + 0.02',
    transformar: (r, g, b) => [r * 0.90, g, b * 1.12 + 0.02],
  },
  {
    id: 'teal-orange',
    titulo: 'Teal & Orange (sombra para ciano, luz para laranja, por luminancia)',
    formula: 'L = luminancia(r,g,b) · sombra = (1-L) · luz = L'
      + ' · R += 0.15*(luz-sombra) · G += 0.05*sombra · B += 0.15*(sombra-luz)',
    transformar: (r, g, b) => {
      const l = luminancia(r, g, b);
      const sombra = 1 - l;
      const luz = l;
      return [
        r + 0.15 * (luz - sombra),
        g + 0.05 * sombra,
        b + 0.15 * (sombra - luz),
      ];
    },
  },
  {
    id: 'contraste-suave',
    titulo: 'Contraste suave (curva S leve)',
    formula: 'curvaS(x, k=1.25) nos tres canais',
    transformar: contraste(1.25),
  },
  {
    id: 'contraste-forte',
    titulo: 'Contraste forte (curva S forte)',
    formula: 'curvaS(x, k=1.8) nos tres canais',
    transformar: contraste(1.8),
  },
  {
    id: 'desbotado',
    titulo: 'Desbotado (preto elevado, branco reduzido, saturacao -20%)',
    formula: 'lift: x = 0.08 + x*0.84 · depois satura(0.8) em torno da luminancia',
    transformar: encadear(
      (r, g, b) => [0.08 + r * 0.84, 0.08 + g * 0.84, 0.08 + b * 0.84],
      saturar(0.8),
    ),
  },
  {
    id: 'vintage',
    titulo: 'Vintage (desbotado + quente + leve verde nas sombras)',
    formula: 'desbotado, depois quente, depois G += 0.05*(1-L) nas sombras',
    transformar: encadear(
      (r, g, b) => [0.08 + r * 0.84, 0.08 + g * 0.84, 0.08 + b * 0.84],
      saturar(0.8),
      (r, g, b) => [r * 1.12 + 0.02, g, b * 0.90],
      (r, g, b) => [r, g + 0.05 * (1 - luminancia(r, g, b)), b],
    ),
  },
  {
    id: 'pb',
    titulo: 'Preto e branco (dessatura total)',
    formula: 'out = luminancia(r,g,b) nos tres canais (satura(0))',
    transformar: saturar(0),
  },
  {
    id: 'pb-contraste',
    titulo: 'Preto e branco com contraste (dessatura + curva S forte)',
    formula: 'satura(0), depois curvaS(x, k=1.6)',
    transformar: encadear(saturar(0), contraste(1.6)),
  },
  {
    id: 'vivido',
    titulo: 'Vivido (saturacao +25%, curva S leve)',
    formula: 'satura(1.25), depois curvaS(x, k=1.12)',
    transformar: encadear(saturar(1.25), contraste(1.12)),
  },
  {
    id: 'noite',
    titulo: 'Noite (azul nas sombras, luzes neutras, exposicao -10%)',
    formula: 'x = x*0.9 · depois B += 0.08*(1-L), R -= 0.04*(1-L) so nas sombras',
    transformar: encadear(
      (r, g, b) => [r * 0.9, g * 0.9, b * 0.9],
      (r, g, b) => {
        const sombra = 1 - luminancia(r, g, b);
        return [r - 0.04 * sombra, g, b + 0.08 * sombra];
      },
    ),
  },
];

function gerarCube({ id, titulo, formula, transformar }) {
  const linhas = [];
  linhas.push(`TITLE "${id}"`);
  linhas.push(`# ${titulo}`);
  linhas.push(`# formula: ${formula}`);
  linhas.push('LUT_3D_SIZE 17');
  linhas.push('DOMAIN_MIN 0.0 0.0 0.0');
  linhas.push('DOMAIN_MAX 1.0 1.0 1.0');

  // Ordem exigida pelo formato .cube: R varia mais rapido, depois G, depois B.
  for (let bi = 0; bi < TAMANHO; bi++) {
    const b = bi / (TAMANHO - 1);
    for (let gi = 0; gi < TAMANHO; gi++) {
      const g = gi / (TAMANHO - 1);
      for (let ri = 0; ri < TAMANHO; ri++) {
        const r = ri / (TAMANHO - 1);
        const [ro, go, bo] = transformar(r, g, b);
        linhas.push(`${clamp01(ro).toFixed(6)} ${clamp01(go).toFixed(6)} ${clamp01(bo).toFixed(6)}`);
      }
    }
  }
  return linhas.join('\n') + '\n';
}

for (const lut of LUTS) {
  const conteudo = gerarCube(lut);
  fs.writeFileSync(path.join(aqui, `${lut.id}.cube`), conteudo);
  console.log(`gerado luts/${lut.id}.cube (${conteudo.split('\n').length - 1} linhas)`);
}

console.log(`\n${LUTS.length} LUTs geradas em ${aqui}`);
