import { cssDe, FRASE_AMOSTRA } from '/shared/presets.js';

/*
 * Roda a mesma animacao que o preset de legenda faz no video, sobre a frase de
 * amostra — para o card da aba Estilo (app.js) e a pagina de verificacao
 * visual (amostras.html) usarem exatamente a mesma logica, num modulo so.
 *
 * Espelha `remotion/Legenda.jsx`: se um campo do contrato muda la, muda aqui.
 */

export const PALAVRAS_AMOSTRA = FRASE_AMOSTRA.split(' ');
export const POR_PALAVRA = 0.42;                                   // segundos por palavra
export const CICLO = PALAVRAS_AMOSTRA.length * POR_PALAVRA + 0.7;  // + respiro no fim

export function amostraLegenda(p, t, cor) {
  // `escala` do preset multiplica o corpo, e `maiusculas` vira text-transform
  // no container — igual ao render.
  const est = cssDe(p.base(cor))
    + (p.escala ? `;font-size:${p.escala}em` : '')
    + (p.maiusculas ? ';text-transform:uppercase' : '');
  // O atributo do estilo usa aspas simples: `fontFamily` de fonte com espaço
  // no nome (ex. "Bebas Neue") vem com aspas duplas no valor, e aspas duplas
  // no atributo cortariam o style no meio, quebrando o resto do card.
  if (p.modo === 'nenhum') return `<span style='${est}'>${p.amostra}</span>`;

  const i = Math.min(PALAVRAS_AMOSTRA.length - 1, Math.floor(t / POR_PALAVRA));
  // `transformAtivo` so vale com display: inline-block.
  const ativo = cssDe(p.ativo(cor))
    + (p.transformAtivo ? `;display:inline-block;transform:${p.transformAtivo}` : '');
  const passado = p.passado ? cssDe(p.passado(cor)) : '';
  const futuro = p.futuro ? cssDe(p.futuro(cor)) : '';

  // `fundoLinha` (faixa, bolha) huga so o texto: um wrapper inline-block
  // dentro do span largo, que continua sendo quem centraliza.
  const envolver = (html) => (p.fundoLinha
    ? `<span style='display:inline-block;${cssDe(p.fundoLinha(cor))}'>${html}</span>`
    : html);

  if (p.modo === 'palavra') {
    return `<span style='${est}'>${envolver(PALAVRAS_AMOSTRA[i])}</span>`;
  }
  const janela = p.janela || 3;
  const de = Math.floor(i / janela) * janela;
  const pedaco = PALAVRAS_AMOSTRA.slice(de, de + janela);
  const linhas = p.linhas || 1;
  const porLinha = Math.ceil(pedaco.length / linhas);

  // O separador vem ANTES da palavra: assim a quebra de linha nunca engole o
  // espaco entre as duas palavras vizinhas.
  const html = pedaco.map((w, k) => {
    const antes = k === 0 ? ''
      : (linhas > 1 && k % porLinha === 0) ? '<br>' : ' ';
    const idx = de + k;
    let estiloPalavra;
    if (idx === i) estiloPalavra = ativo;
    // No modo acumula a palavra que ainda nao foi dita fica invisivel (mas
    // continua ocupando o lugar dela); nos outros modos ganha o estilo `futuro`.
    else if (idx > i) estiloPalavra = p.modo === 'acumula' ? 'visibility:hidden' : futuro;
    else estiloPalavra = passado;
    return `${antes}<span style='${estiloPalavra}'>${w}</span>`;
  }).join('');
  return `<span style='${est}'>${envolver(html)}</span>`;
}
