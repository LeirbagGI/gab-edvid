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

/**
 * `override` (opcional) e o mesmo formato de `estilo.legenda` (API-2): o card
 * da aba Estilo usa para refletir ao vivo o que o usuario esta ajustando —
 * `escala` multiplica a do preset, `maiusculas` (true|false) forca o estado
 * (ausente/null mantem o do preset), `alinhamento` e `posicao` mexem em
 * texto e posicao vertical dentro do card. Sem `override`, o resultado e
 * identico ao de antes (amostras.html continua chamando sem o 4o argumento).
 */
export function amostraLegenda(p, t, cor, override) {
  const escalaOverride = override?.escala;
  const maiusculasOverride = override?.maiusculas;
  const alinhamentoOverride = override?.alinhamento;
  const posicaoOverride = override?.posicao;

  const escalaFinal = (p.escala || 1) * (typeof escalaOverride === 'number' ? escalaOverride : 1);
  const maiusculasFinal = maiusculasOverride === true ? true
    : maiusculasOverride === false ? false
      : !!p.maiusculas;

  // `escala`/`maiusculas` do preset ja tinham esse mesmo efeito sem override
  // (compatibilidade com amostras.html, que chama sem o 4o argumento).
  let extra = (escalaFinal !== 1 ? `;font-size:${escalaFinal}em` : '')
    + (maiusculasFinal ? ';text-transform:uppercase' : '');
  if (alinhamentoOverride) extra += `;text-align:${alinhamentoOverride === 'esquerda' ? 'left' : 'center'}`;
  if (posicaoOverride) {
    const alinha = posicaoOverride === 'alto' ? 'flex-start' : posicaoOverride === 'meio' ? 'center' : 'flex-end';
    extra += `;align-self:${alinha}`;
  }

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
