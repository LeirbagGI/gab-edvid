import { CORTE, BLOCOS } from '../shared/config.js';

const NORMALIZAR_SIMPLES = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// Palavras de ligacao: nunca fecham uma fala sozinhas, mesmo com pausa ou
// virgula depois. "...que" no fim de um pedaco e frase cortada, nao fim de ideia.
const CONECTORES = new Set([
  'que', 'e', 'de', 'do', 'da', 'para', 'pra', 'com', 'sem', 'mas', 'ou',
  'se', 'o', 'a', 'os', 'as', 'um', 'uma',
]);

const ehConector = (texto) => CONECTORES.has(NORMALIZAR_SIMPLES(texto).replace(/[^a-z]/g, ''));

/**
 * Junta palavras em falas: quebra quando o intervalo entre uma palavra e a
 * proxima passa de pausaInternaMaxS, ou quando a palavra termina em pontuacao forte.
 *
 * Quebra "fraca" (silencio real detectado no audio, ou virgula/clausula) so
 * vale se o pedaco que fica para tras ja fecha frase, ou tem 4+ palavras e um
 * gap de verdade (>= silencioMinimoS); senao e meio de oracao e segue
 * juntando ate maxFala. Isso e o que evita picar "existem tres erros que" /
 * "travam o faturamento..." em dois clipes (H4).
 */
export function agruparEmFalas(palavras, {
  pausaMax = CORTE.pausaInternaMaxS,
  silencios = [],
  maxFala = 7,
} = {}) {
  // Quebras vindas do SILENCIO REAL do audio. E a fonte confiavel: o Whisper
  // nem sempre devolve pontuacao, e emite as palavras coladas (fim de uma =
  // inicio da outra), entao contar so com ele deixa o video inteiro num clipe.
  const quebrasPorSilencio = new Set();
  for (const s of silencios) {
    if (s.fim - s.inicio < CORTE.silencioMinimoS) continue;
    let idx = -1;
    for (let i = 0; i < palavras.length; i++) {
      if (palavras[i].fim <= s.inicio + 0.2) idx = i; else break;
    }
    if (idx >= 0 && idx < palavras.length - 1) quebrasPorSilencio.add(idx);
  }

  const falas = [];
  let atual = null;

  for (const [i, p] of palavras.entries()) {
    if (!atual) {
      atual = { inicio: p.inicio, fim: p.fim, palavras: [p] };
      continue;
    }
    const gap = p.inicio - atual.fim;
    const anterior = atual.palavras.at(-1).texto;
    const fechouFrase = /[.!?]$/.test(anterior);
    const fechouClausula = /[,;:]$/.test(anterior);
    const duracaoAtual = atual.fim - atual.inicio;
    const numPalavras = atual.palavras.length;

    // Quebra fraca: silencio real do audio, ou virgula/clausula com pausa.
    // "Pausa curta demais" (gap > pausaMax) e trava de seguranca a parte,
    // nao entra na regra de nao-picar-oracao — ela ja e um gap grande o
    // bastante (0.45s+) para ser corte por si so.
    const viaSilencioReal = quebrasPorSilencio.has(i - 1);
    const viaClausula = fechouClausula && gap > 0.12;
    const quebraFraca = viaSilencioReal || viaClausula;

    // O gap efetivo da quebra fraca: silencio real ja passou pelo filtro de
    // silencioMinimoS na deteccao (linha 17), entao conta como satisfeito.
    const gapEfetivo = viaSilencioReal ? Math.max(gap, CORTE.silencioMinimoS) : gap;

    const podeQuebrarPorOracao = fechouFrase
      || (numPalavras >= 4 && gapEfetivo >= CORTE.silencioMinimoS);

    const quebrar = fechouFrase
      // Trava de seguranca: fala sem pontuacao nem silencio nao pode virar
      // um bloco unico de minutos.
      || duracaoAtual >= maxFala
      || gap > pausaMax
      || (quebraFraca && podeQuebrarPorOracao && !ehConector(anterior));

    if (quebrar) {
      falas.push(atual);
      atual = { inicio: p.inicio, fim: p.fim, palavras: [p] };
    } else {
      atual.fim = p.fim;
      atual.palavras.push(p);
    }
  }
  if (atual) falas.push(atual);

  // Encosta as bordas no silencio: e assim que o silencio sai do corte.
  for (const f of falas) {
    for (const s of silencios) {
      if (s.inicio <= f.inicio && s.fim > f.inicio && s.fim < f.fim) f.inicio = s.fim;
      if (s.fim >= f.fim && s.inicio < f.fim && s.inicio > f.inicio) f.fim = s.inicio;
    }
  }

  return falas.map((f) => ({
    ...f,
    texto: f.palavras.map((p) => p.texto).join(' ').replace(/\s+([,.!?])/g, '$1'),
    duracao: f.fim - f.inicio,
  }));
}

const NORMALIZAR = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const FORMAS_PROMESSA = new Set([
  'ganhar', 'ganha', 'ganho', 'ganhando', 'ganhei', 'ganharam',
  'dobrar', 'dobra', 'dobro', 'dobrando', 'dobrou', 'dobraram',
  'vender', 'vende', 'vendo', 'vendendo', 'vendeu', 'venderam',
  'faturar', 'fatura', 'faturo', 'faturando', 'faturou', 'faturaram', 'faturamento',
  'crescer', 'cresce', 'cresco', 'crescendo', 'cresceu', 'cresceram',
  'parar', 'para', 'paro', 'parando', 'parou', 'pararam',
  'perder', 'perde', 'perco', 'perdendo', 'perdeu', 'perderam',
  'multiplicar', 'multiplica', 'multiplico', 'multiplicando', 'multiplicou', 'multiplicaram',
  'economizar', 'economiza', 'economizo', 'economizando', 'economizou', 'economizaram',
]);

const NEGACOES_FORTES = new Set(['nunca', 'nada', 'ninguem', 'jamais']);

/**
 * Marca `destaque: true` em no maximo `maxPorBloco` palavras a cada
 * `tamanhoBloco` palavras (~4, o tamanho tipico de um bloco de legenda):
 * numeros e R$/%, verbos de promessa, negacoes fortes, caixa alta na
 * transcricao, e nomes proprios (maiuscula inicial fora de comeco de frase).
 * Heuristica — o Fable pode refinar por cima pela ferramenta `destacar_palavras`.
 */
export function marcarDestaques(palavras, { tamanhoBloco = 4, maxPorBloco = 2 } = {}) {
  const candidatos = palavras.map((p, i) => {
    const limpo = p.texto.replace(/[.,!?;:]+$/, '');
    const norm = NORMALIZAR(limpo).replace(/[^a-z]/g, '');
    const anteriorFechouFrase = i > 0 && /[.!?]$/.test((palavras[i - 1]?.texto || '').trim());

    let prioridade = 0;
    if (/\d|r\$|%/.test(NORMALIZAR(limpo))) prioridade = 1;
    else if (FORMAS_PROMESSA.has(norm)) prioridade = 2;
    else if (NEGACOES_FORTES.has(norm)) prioridade = 3;
    else if (/^[A-ZÀ-Ú]{2,}$/.test(limpo)) prioridade = 4;
    else if (i > 0 && !anteriorFechouFrase && /^[A-ZÀ-Ú][a-zà-ú]+$/.test(limpo)) prioridade = 5;

    return { i, prioridade };
  });

  const marcados = new Set();
  for (let inicio = 0; inicio < palavras.length; inicio += tamanhoBloco) {
    const escolhidos = candidatos.slice(inicio, inicio + tamanhoBloco)
      .filter((c) => c.prioridade > 0)
      .sort((a, b) => a.prioridade - b.prioridade)
      .slice(0, maxPorBloco);
    for (const c of escolhidos) marcados.add(c.i);
  }

  return palavras.map((p, i) => ({ ...p, destaque: marcados.has(i) }));
}

const RUIDO = /^(ah+|eh+|hum+|hm+|uh+|tipo|ne|né|entao|então|assim|ta|tá|é|e)$/i;

/**
 * Marca falas que o corte organico deve descartar:
 * - muito curtas e sem conteudo (respiro, "ah", "hum")
 * - false start: a fala e um prefixo da fala seguinte (a pessoa recomecou)
 * - repeticao literal da fala anterior (segunda tomada)
 */
export function marcarDescartes(falas) {
  const normal = (t) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w\s]/g, '').trim();

  return falas.map((f, i) => {
    const motivos = [];
    const palavras = f.palavras.map((p) => normal(p.texto)).filter(Boolean);

    if (f.duracao < 0.28 && palavras.length <= 1) motivos.push('respiro');
    if (palavras.length > 0 && palavras.every((p) => RUIDO.test(p)) && palavras.length <= 2) {
      motivos.push('muleta');
    }

    const prox = falas[i + 1];
    if (prox) {
      const a = normal(f.texto);
      const b = normal(prox.texto);
      if (a.length >= 4 && b.startsWith(a) && b.length > a.length * 1.3) motivos.push('false-start');
      if (a.length >= 8 && a === b) motivos.push('repeticao');
      // Tomada refeita: mesmas 4 primeiras palavras, a seguinte e mais longa.
      const ini = (s) => s.split(' ').slice(0, 4).join(' ');
      if (a.split(' ').length >= 4 && ini(a) === ini(b) && b.length > a.length) motivos.push('tomada-refeita');
    }

    return { ...f, descartar: motivos.length > 0, motivos };
  });
}

/**
 * Fecha as bordas de cada fala mantida: aplica padding e nunca deixa
 * o corte cair dentro de uma regiao de fala vizinha.
 */
export function fecharBordas(falas, duracaoTotal) {
  const vivas = falas.filter((f) => !f.descartar);
  return vivas.map((f, i) => {
    const ant = vivas[i - 1];
    const prox = vivas[i + 1];
    let inicio = Math.max(0, f.inicio - CORTE.padInicioS);
    let fim = Math.min(duracaoTotal, f.fim + CORTE.padFimS);
    if (ant) inicio = Math.max(inicio, ant.fim + 0.01);
    if (prox) fim = Math.min(fim, prox.inicio - 0.01);
    return { ...f, inicio, fim, duracao: fim - inicio };
  }).filter((f) => f.duracao > 0.12);
}

/**
 * Cola no vizinho os clipes menores que clipeMinimoS (nenhum clipe ativo vira
 * corte visual de menos de ~1,6s se puder ser evitado — H4). So funde com
 * vizinho do mesmo periodo de fala (gap <= gapFusaoS) e escolhe sempre o de
 * menor gap. Nunca passa de maxFala, a nao ser que a alternativa seja deixar
 * um fragmento de menos de 0,8s sozinho.
 */
export function fundirVizinhas(falas, {
  minimo = CORTE.clipeMinimoS,
  gapMax = CORTE.gapFusaoS,
  maxFala = 7,
} = {}) {
  const clipes = falas.map((f) => ({ ...f, palavras: [...f.palavras] }));

  let mudou = true;
  while (mudou) {
    mudou = false;
    for (let i = 0; i < clipes.length; i++) {
      const c = clipes[i];
      if (c.duracao >= minimo) continue;

      const ant = clipes[i - 1];
      const prox = clipes[i + 1];
      const candidatos = [];
      if (ant) candidatos.push({ lado: 'ant', gap: c.inicio - ant.fim, vizinho: ant });
      if (prox) candidatos.push({ lado: 'prox', gap: prox.inicio - c.fim, vizinho: prox });
      const elegiveis = candidatos.filter((cand) => cand.gap <= gapMax);
      if (!elegiveis.length) continue;

      elegiveis.sort((a, b) => a.gap - b.gap);
      const escolhido = elegiveis[0];
      const [esq, dir] = escolhido.lado === 'ant' ? [escolhido.vizinho, c] : [c, escolhido.vizinho];
      const duracaoFundida = dir.fim - esq.inicio;

      // Nunca cria clipe maior que maxFala, exceto quando a alternativa e
      // deixar um fragmento < 0,8s sozinho: aí o fragmento perde.
      if (duracaoFundida > maxFala && c.duracao >= 0.8) continue;

      const fundido = {
        ...esq,
        fim: dir.fim,
        duracao: duracaoFundida,
        palavras: [...esq.palavras, ...dir.palavras],
        texto: `${esq.texto} ${dir.texto}`.trim(),
      };
      const idxRemover = escolhido.lado === 'ant' ? i - 1 : i;
      clipes.splice(idxRemover, 2, fundido);
      mudou = true;
      break;
    }
  }
  return clipes;
}

/**
 * Um clipe por CTA quando cabe: se todos os clipes classificados como CTA
 * somados nao passarem de maxFala e os gaps entre eles nao passarem de
 * gapFusaoS, funde tudo num so. E o que evita quatro cortes secos de
 * 0,6-1,2s no fechamento do reel (H4).
 */
export function fundirCTA(clipes, { maxFala = 7, gapMax = CORTE.gapFusaoS } = {}) {
  const inicioCta = clipes.findIndex((c) => c.bloco === 'CTA');
  if (inicioCta === -1) return clipes;

  // Blocos sao monotonos (classificarBlocos garante): tudo a partir do
  // primeiro CTA tambem e CTA.
  const ctas = clipes.slice(inicioCta);
  if (ctas.length <= 1) return clipes;

  const duracaoTotal = ctas.reduce((s, c) => s + c.duracao, 0);
  const gapsOk = ctas.every((c, i) => i === 0 || c.inicio - ctas[i - 1].fim <= gapMax);
  if (duracaoTotal > maxFala || !gapsOk) return clipes;

  const primeiro = ctas[0];
  const ultimo = ctas.at(-1);
  const fundido = {
    ...primeiro,
    fim: ultimo.fim,
    duracao: ultimo.fim - primeiro.inicio,
    palavras: ctas.flatMap((c) => c.palavras),
    texto: ctas.map((c) => c.texto).join(' ').trim(),
  };
  return [...clipes.slice(0, inicioCta), fundido];
}

/**
 * Classifica os clipes em HOOK / DINAMICA / RECURSOS / CTA por posicao e por
 * pista de texto. Heuristica local — a IA pode reescrever isso depois.
 */
export function classificarBlocos(clipes) {
  const total = clipes.reduce((s, c) => s + c.duracao, 0) || 1;
  const RE_CTA = /(link na bio|na bio|no direct|comenta|comente|manda|chama|me segue|siga|clica|clique|inscrev|saiba mais|corre pra)/i;
  const RE_RECURSOS = /(alem disso|além disso|tambem|também|recurso|funciona|ferramenta|voce pode|você pode|serve pra|da pra)/i;

  // 1. Banda base por posicao relativa na linha do tempo.
  let acumulado = 0;
  const base = clipes.map((c, i) => {
    const inicioRel = acumulado / total;
    acumulado += c.duracao;
    let bloco;
    if (i === 0 || inicioRel < 0.18) bloco = 'HOOK';
    else if (inicioRel < 0.5) bloco = 'DINAMICA';
    else if (inicioRel < 0.82) bloco = 'RECURSOS';
    else bloco = 'CTA';
    return bloco;
  });

  // 2. As pistas de texto so puxam para frente (RECURSOS/CTA), nunca para tras.
  clipes.forEach((c, i) => {
    if (RE_CTA.test(c.texto) && i > 0) base[i] = 'CTA';
    else if (RE_RECURSOS.test(c.texto) && BLOCOS.indexOf(base[i]) < 2) base[i] = 'RECURSOS';
  });

  // 3. Monotonia: o bloco nunca volta atras, senao a timeline fica picotada.
  let piso = 0;
  for (let i = 0; i < base.length; i++) {
    const idx = Math.max(piso, BLOCOS.indexOf(base[i]));
    base[i] = BLOCOS[idx];
    piso = idx;
  }
  // Um CTA solto no meio arrasta todo o resto; so vale se estiver no ultimo terco.
  const primeiroCta = base.indexOf('CTA');
  if (primeiroCta !== -1 && primeiroCta < base.length * 0.6) {
    for (let i = primeiroCta; i < base.length * 0.6; i++) base[i] = 'RECURSOS';
  }
  if (base.length) base[0] = 'HOOK';

  return clipes.map((c, i) => ({ ...c, bloco: base[i] }));
}

/** Pipeline completo do corte organico, de palavras cruas para clipes rotulados. */
export function corteOrganico(palavras, duracaoTotal, silencios = []) {
  const comDestaque = marcarDestaques(palavras);
  const falas = agruparEmFalas(comDestaque, { silencios });
  const marcadas = marcarDescartes(falas);
  const fechadas = fecharBordas(marcadas, duracaoTotal);
  const fundidas = fundirVizinhas(fechadas);
  const classificados = classificarBlocos(fundidas);
  const clipes = fundirCTA(classificados);

  return {
    clipes: clipes.map((c, i) => ({
      id: `c${i + 1}`,
      bloco: c.bloco,
      origemInicio: Number(c.inicio.toFixed(3)),
      origemFim: Number(c.fim.toFixed(3)),
      duracao: Number(c.duracao.toFixed(3)),
      texto: c.texto,
      palavras: c.palavras.map((p) => ({
        inicio: Number(p.inicio.toFixed(3)),
        fim: Number(p.fim.toFixed(3)),
        texto: p.texto,
        destaque: !!p.destaque,
      })),
    })),
    descartados: marcadas.filter((f) => f.descartar).map((f) => ({
      inicio: Number(f.inicio.toFixed(3)),
      fim: Number(f.fim.toFixed(3)),
      texto: f.texto,
      motivos: f.motivos,
    })),
  };
}
