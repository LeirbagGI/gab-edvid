import { cssDe, FRASE_AMOSTRA } from '/shared/presets.js';
import {
  agruparBlocos, agrupamentoDoPreset, estadoEm, estiloBloco, estiloPalavra, emojiDoBloco,
} from '/shared/legenda-motor.js';

/*
 * Roda o mesmo motor de animacao que o video usa (legenda-motor.js) sobre a
 * frase de amostra — para o card da aba Estilo (app.js) e a pagina de
 * verificacao visual (amostras.html) ficarem exatamente iguais ao Remotion,
 * por construcao. Espelha `remotion/Legenda.jsx`.
 */

export const PALAVRAS_AMOSTRA = FRASE_AMOSTRA.split(' ');
export const POR_PALAVRA = 0.42;                                   // segundos por palavra
export const CICLO = PALAVRAS_AMOSTRA.length * POR_PALAVRA + 0.7;  // + respiro no fim

// Linha do tempo sintetica: cada palavra ocupa um slot de POR_PALAVRA.
const PALAVRAS_TEMPO = PALAVRAS_AMOSTRA.map((texto, i) => ({
  texto, inicio: i * POR_PALAVRA, fim: i * POR_PALAVRA + POR_PALAVRA, destaque: false,
}));

// Os blocos de um preset nao mudam com `t` — so precisam ser recalculados se
// o preset mudar (o agrupamento e fixo por preset), entao ficam em cache.
const blocosPorPreset = new Map();
function blocosDe(preset) {
  if (!blocosPorPreset.has(preset.id)) {
    blocosPorPreset.set(preset.id, agruparBlocos(PALAVRAS_TEMPO, { ...agrupamentoDoPreset(preset), pausaMax: 0.6 }));
  }
  return blocosPorPreset.get(preset.id);
}

export function amostraLegenda(p, t, cor) {
  // `escala` do preset multiplica o corpo, e `maiusculas` vira text-transform
  // no container — igual ao render.
  const extra = (p.escala ? `;font-size:${p.escala}em` : '')
    + (p.maiusculas ? ';text-transform:uppercase' : '');

  if (p.modo === 'nenhum') return `<span style='${cssDe(p.base(cor))}${extra}'>${p.amostra}</span>`;

  const blocos = blocosDe(p);
  const estado = estadoEm(blocos, t);
  if (!estado) return `<span style='${cssDe(p.base(cor))}${extra}'></span>`;

  const {
    bloco, dtBloco, indiceAtiva, dtPalavra, progressoPalavra,
  } = estado;
  const containerCss = cssDe({ ...p.base(cor), ...estiloBloco(p, { dtBloco, cor }) }) + extra;
  const emoji = p.emoji ? emojiDoBloco(bloco) : null;

  // `fundoLinha` (faixa, bolha, moldura) huga so o texto: um wrapper
  // inline-block dentro do span largo, que continua sendo quem centraliza.
  const envolver = (html) => (p.fundoLinha
    ? `<span style='display:inline-block;${cssDe(p.fundoLinha(cor))}'>${html}</span>`
    : html);

  // O separador vem ANTES da palavra: assim a quebra de linha nunca engole o
  // espaco entre as duas palavras vizinhas.
  const palavraHtml = (idx, comEspaco) => {
    const w = bloco.palavras[idx];
    const estadoPalavra = idx < indiceAtiva ? 'passada' : idx > indiceAtiva ? 'futura' : 'ativa';
    const ehAtiva = estadoPalavra === 'ativa';
    const dtP = ehAtiva ? dtPalavra : 0;
    const progresso = ehAtiva ? progressoPalavra : (estadoPalavra === 'passada' ? 1 : 0);
    const espaco = comEspaco ? ' ' : '';

    if (ehAtiva && p.ativa === 'onda') {
      const letras = [...w.texto].map((letra, li) => `<span style='${cssDe(estiloPalavra(p, {
        estado: estadoPalavra, destaque: w.destaque, dtPalavra: dtP, progresso, cor, indiceLetra: li,
      }))}'>${letra}</span>`).join('');
      return `${espaco}<span>${letras}</span>`;
    }

    const est = cssDe(estiloPalavra(p, {
      estado: estadoPalavra, destaque: w.destaque, dtPalavra: dtP, progresso, cor,
    }));
    // O separador fica FORA do span animado (mesma razao do Legenda.jsx):
    // um espaco de abertura dentro de um `display: inline-block` some.
    return `${espaco}<span style='${est}'>${w.texto}</span>`;
  };

  const linhasHtml = bloco.linhas
    .map((linha) => linha.map((idx, k) => palavraHtml(idx, k > 0)).join(''))
    .join('<br>');

  return `<span style='${containerCss}'>${envolver(linhasHtml)}${emoji ? ` ${emoji}` : ''}</span>`;
}
