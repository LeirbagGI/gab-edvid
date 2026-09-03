/**
 * Edicao de legenda: mexe direto em `projeto.fase1.clipes[].palavras`.
 * Logica pura sobre o array de clipes (sem `fs`, sem rota) — quem chama
 * (`index.js`) e quem carrega/salva o projeto e transmite pelo WebSocket.
 *
 * Todas as funcoes mutam o clipe encontrado (e o array `palavras` dele) e
 * devolvem o que mudou; jogam `Error` com mensagem legivel quando o pedido
 * nao bate (indice fora, invade a palavra vizinha, etc) — quem chama vira
 * isso em 400.
 */

function acharClipe(clipes, id) {
  const c = (clipes || []).find((x) => x.id === id);
  if (!c) throw new Error(`clipe "${id}" nao encontrado`);
  if (!Array.isArray(c.palavras)) c.palavras = [];
  return c;
}

function acharPalavra(clipe, indice) {
  const idx = Number(indice);
  const p = clipe.palavras[idx];
  if (!p) throw new Error(`palavra ${indice} nao encontrada no clipe ${clipe.id}`);
  return { idx, p };
}

/**
 * Edita uma palavra: `texto`, `inicio`/`fim` (validando `inicio < fim` e que
 * nao invade a palavra vizinha), `oculta` (a legenda pula a palavra, o audio
 * segue) e `destaque`. Only manda os campos que vieram no pedido.
 */
export function editarPalavra(clipes, {
  clipe, indice, texto, inicio, fim, oculta, destaque,
} = {}) {
  const c = acharClipe(clipes, clipe);
  const { idx, p } = acharPalavra(c, indice);

  const novoInicio = typeof inicio === 'number' ? inicio : p.inicio;
  const novoFim = typeof fim === 'number' ? fim : p.fim;
  if (novoInicio >= novoFim) throw new Error('inicio precisa ser menor que fim');

  const anterior = c.palavras[idx - 1];
  const seguinte = c.palavras[idx + 1];
  if (anterior && novoInicio < anterior.fim) throw new Error('inicio invade a palavra anterior');
  if (seguinte && novoFim > seguinte.inicio) throw new Error('fim invade a palavra seguinte');

  if (typeof texto === 'string') p.texto = texto;
  if (typeof inicio === 'number') p.inicio = Number(inicio.toFixed(3));
  if (typeof fim === 'number') p.fim = Number(fim.toFixed(3));
  if (typeof oculta === 'boolean') p.oculta = oculta;
  if (typeof destaque === 'boolean') p.destaque = destaque;
  return p;
}

/**
 * Divide a palavra em `indice` em duas, no caractere `posicao` (1..len-1).
 * O tempo se divide proporcional ao numero de letras de cada metade.
 */
export function dividirPalavra(clipes, { clipe, indice, posicao } = {}) {
  const c = acharClipe(clipes, clipe);
  const { idx, p } = acharPalavra(c, indice);

  const texto = String(p.texto || '');
  const pos = Number(posicao);
  if (!Number.isInteger(pos) || pos <= 0 || pos >= texto.length) {
    throw new Error(`posicao invalida para dividir "${texto}" (precisa ser entre 1 e ${texto.length - 1})`);
  }

  const parte1 = texto.slice(0, pos);
  const parte2 = texto.slice(pos);
  const duracao = p.fim - p.inicio;
  const meio = Number((p.inicio + duracao * (parte1.length / texto.length)).toFixed(3));

  const nova1 = { ...p, texto: parte1, fim: meio };
  const nova2 = { ...p, texto: parte2, inicio: meio };
  c.palavras.splice(idx, 1, nova1, nova2);
  return [nova1, nova2];
}

/** Junta a palavra em `indice` com a seguinte, somando o texto e o tempo. */
export function juntarPalavra(clipes, { clipe, indice } = {}) {
  const c = acharClipe(clipes, clipe);
  const { idx, p } = acharPalavra(c, indice);
  const seguinte = c.palavras[idx + 1];
  if (!seguinte) throw new Error('nao ha palavra seguinte para juntar');

  const juntada = {
    ...p,
    texto: `${p.texto} ${seguinte.texto}`,
    fim: seguinte.fim,
    destaque: Boolean(p.destaque || seguinte.destaque),
  };
  c.palavras.splice(idx, 2, juntada);
  return juntada;
}

/**
 * Desloca a palavra em `indice` por `deltaS` segundos — ou, com `ateOFim`,
 * ela e todas as que vem depois, ate o fim do clipe. Nao deixa invadir a
 * palavra anterior nem (fora do `ateOFim`) a seguinte; com `ateOFim`, nao
 * deixa passar do fim do clipe.
 */
export function empurrarPalavra(clipes, {
  clipe, indice, deltaS, ateOFim,
} = {}) {
  const c = acharClipe(clipes, clipe);
  const { idx } = acharPalavra(c, indice);

  const delta = Number(deltaS);
  if (!Number.isFinite(delta) || delta === 0) throw new Error('deltaS precisa ser um numero diferente de zero');

  const alvo = ateOFim ? c.palavras.slice(idx) : [c.palavras[idx]];
  const anterior = c.palavras[idx - 1];
  const primeiroNovoInicio = alvo[0].inicio + delta;
  if (primeiroNovoInicio < 0) throw new Error('empurrar deixaria a palavra antes do inicio (0s)');
  if (anterior && primeiroNovoInicio < anterior.fim) throw new Error('empurrar invade a palavra anterior');

  const ultimo = alvo.at(-1);
  const ultimoNovoFim = ultimo.fim + delta;
  if (ateOFim) {
    if (typeof c.fim === 'number' && ultimoNovoFim > c.fim) {
      throw new Error('empurrar ultrapassa o fim do clipe');
    }
  } else {
    const seguinte = c.palavras[idx + 1];
    if (seguinte && ultimoNovoFim > seguinte.inicio) throw new Error('empurrar invade a palavra seguinte');
  }

  for (const w of alvo) {
    w.inicio = Number((w.inicio + delta).toFixed(3));
    w.fim = Number((w.fim + delta).toFixed(3));
  }
  return alvo;
}

const POSICOES_LEGENDA = ['baixo', 'meio', 'alto'];
const ALINHAMENTOS_LEGENDA = ['centro', 'esquerda'];

/**
 * Valida o corpo de `PUT /api/projeto/:nome/legenda` (override de
 * `estilo.legenda`, por cima do preset). Devolve a lista de erros — vazia
 * quando esta tudo certo.
 */
export function validarConfigLegenda(corpo) {
  const erros = [];
  const c = corpo || {};

  if (c.posicao !== undefined && !POSICOES_LEGENDA.includes(c.posicao)) {
    erros.push(`posicao invalida: "${c.posicao}" (use ${POSICOES_LEGENDA.join(' | ')})`);
  }
  if (c.escala !== undefined) {
    if (typeof c.escala !== 'number' || c.escala < 0.7 || c.escala > 1.6) {
      erros.push('escala precisa ser numero entre 0.7 e 1.6');
    }
  }
  if (c.alinhamento !== undefined && !ALINHAMENTOS_LEGENDA.includes(c.alinhamento)) {
    erros.push(`alinhamento invalido: "${c.alinhamento}" (use ${ALINHAMENTOS_LEGENDA.join(' | ')})`);
  }
  if (c.maiusculas !== undefined && c.maiusculas !== null && typeof c.maiusculas !== 'boolean') {
    erros.push('maiusculas precisa ser booleano ou null');
  }
  if (c.antecedencia !== undefined) {
    if (typeof c.antecedencia !== 'number' || c.antecedencia < 0 || c.antecedencia > 0.4) {
      erros.push('antecedencia precisa ser numero entre 0 e 0.4');
    }
  }
  if (c.maxPalavras !== undefined) {
    if (!Number.isInteger(c.maxPalavras) || c.maxPalavras < 1 || c.maxPalavras > 6) {
      erros.push('maxPalavras precisa ser inteiro entre 1 e 6');
    }
  }
  return erros;
}
