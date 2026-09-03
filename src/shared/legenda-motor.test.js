import assert from 'node:assert/strict';
import test from 'node:test';
import {
  agruparBlocos, estadoEm, estiloBloco, estiloPalavra, interpolar, emojiDoBloco,
} from './legenda-motor.js';

/** Helper: monta uma palavra a partir de texto/inicio/fim. */
const p = (texto, inicio, fim, destaque = false) => ({
  texto, inicio, fim, destaque,
});

test('interpolar mapeia entre pontos e prende nas pontas', () => {
  assert.equal(interpolar(-1, [0, 1], [0, 10]), 0);
  assert.equal(interpolar(2, [0, 1], [0, 10]), 10);
  assert.equal(interpolar(0.5, [0, 1], [0, 10], 'linear'), 5);
});

test('agruparBlocos quebra por pontuacao final', () => {
  const blocos = agruparBlocos([
    p('Oi', 0, 0.2), p('gente.', 0.2, 0.6),
    p('Hoje', 0.7, 1.0), p('eu', 1.0, 1.1),
  ]);
  assert.equal(blocos.length, 2);
  assert.equal(blocos[0].palavras.map((w) => w.texto).join(' '), 'Oi gente.');
  assert.equal(blocos[1].palavras.map((w) => w.texto).join(' '), 'Hoje eu');
});

test('agruparBlocos quebra por virgula quando o bloco ja tem 2+ palavras', () => {
  const blocos = agruparBlocos([
    p('Olha', 0, 0.2), p('so,', 0.2, 0.4), p('vem', 0.5, 0.7), p('ver', 0.7, 0.9),
  ]);
  assert.equal(blocos.length, 2);
  assert.equal(blocos[0].palavras.map((w) => w.texto).join(' '), 'Olha so,');
});

test('agruparBlocos quebra por pausa entre palavras > pausaMax', () => {
  const blocos = agruparBlocos([
    p('Isso', 0, 0.3), p('aqui', 0.3, 0.6),
    p('funciona', 2.0, 2.4), p('mesmo', 2.4, 2.7),
  ], { pausaMax: 0.6 });
  assert.equal(blocos.length, 2);
  assert.equal(blocos[0].fim, 0.6);
  assert.equal(blocos[1].inicio, 2.0);
});

test('agruparBlocos quebra por maxPalavras', () => {
  const porPalavras = agruparBlocos([
    p('um', 0, 0.2), p('dois', 0.2, 0.4), p('tres', 0.4, 0.6), p('quatro', 0.6, 0.8), p('cinco', 0.8, 1.0),
  ], { maxPalavras: 2, pausaMax: 10 });
  assert.equal(porPalavras.length, 3);
  assert.equal(porPalavras[0].palavras.length, 2);
});

test('agruparBlocos quebra por comprimento quando nem 2 linhas dao conta', () => {
  // 'primeira'+'segunda' ja usam as 2 linhas (maxChars 8); 'terceira' nao
  // cabe mais em lugar nenhum do bloco, entao abre um bloco novo.
  const blocos = agruparBlocos([
    p('primeira', 0, 0.3), p('segunda', 0.3, 0.6), p('terceira', 0.6, 0.9),
  ], { maxPalavras: 5, maxChars: 8, pausaMax: 10 });
  assert.equal(blocos.length, 2);
  assert.equal(blocos[0].palavras.length, 2);
  assert.equal(blocos[0].linhas.length, 2);
  assert.equal(blocos[1].palavras[0].texto, 'terceira');
});

test('agruparBlocos preenche bloco.linhas com indices locais', () => {
  const blocos = agruparBlocos([
    p('uma', 0, 0.2), p('linha', 0.2, 0.4), p('soh', 0.4, 0.6),
  ], { maxPalavras: 3, maxChars: 100 });
  assert.equal(blocos.length, 1);
  assert.deepEqual(blocos[0].linhas, [[0, 1, 2]]);
});

const BLOCOS_ESTADO = agruparBlocos([
  p('Isso', 0, 0.3), p('muda', 0.3, 0.6), p('tudo.', 0.6, 0.9),
], { maxPalavras: 3, maxChars: 100 });

test('estadoEm acha a palavra certa e antecipa com antecedencia', () => {
  // Em t=0.28 (antes do fim de "Isso" em 0.3), sem antecedencia ainda não
  // seria "muda"; com antecedencia de 0.12 já e.
  const estado = estadoEm(BLOCOS_ESTADO, 0.28, { antecedencia: 0.12 });
  assert.ok(estado, 'nao deveria ser null dentro do bloco');
  assert.equal(estado.indiceAtiva, 1, 'deveria ja estar em "muda", adiantado pela antecedencia');
});

test('estadoEm devolve null no silencio > 1s', () => {
  // Bloco com um vao interno artificial de 1.5s entre a 1a e a 2a palavra —
  // maior que o `silencio` default de 1.0s.
  const blocos = [{
    inicio: 0,
    fim: 2.0,
    palavras: [
      { texto: 'Isso', inicio: 0, fim: 0.3, destaque: false },
      { texto: 'demorou', inicio: 1.8, fim: 2.0, destaque: false },
    ],
    linhas: [[0, 1]],
  }];
  const noMeioDoSilencio = estadoEm(blocos, 0.6, { antecedencia: 0.12, silencio: 1.0 });
  assert.equal(noMeioDoSilencio, null);

  const dentroDaPrimeira = estadoEm(blocos, 0.1, { antecedencia: 0.12, silencio: 1.0 });
  assert.ok(dentroDaPrimeira);
  assert.equal(dentroDaPrimeira.indiceAtiva, 0);
});

test("estiloBloco('pop') tem escala 0,8 em dt=0 e escala 1 em dt>=0,2", () => {
  const preset = { entrada: 'pop' };
  const est0 = estiloBloco(preset, { dtBloco: 0 });
  assert.match(est0.transform, /scale\(0\.8/);

  const est1 = estiloBloco(preset, { dtBloco: 0.2 });
  assert.match(est1.transform, /scale\(1(\.0+)?\)/);

  const est2 = estiloBloco(preset, { dtBloco: 5 });
  assert.match(est2.transform, /scale\(1(\.0+)?\)/);
});

test("estiloBloco('nenhuma' ou ausente) nao muda nada, so opacidade 1", () => {
  assert.deepEqual(estiloBloco({}, { dtBloco: 1 }), { opacity: 1 });
  assert.deepEqual(estiloBloco({ entrada: 'nenhuma' }, { dtBloco: 1 }), { opacity: 1 });
});

test("estiloPalavra com ativa: 'preenche' e progresso 0.5 tem 50% no gradiente", () => {
  const preset = {
    ativa: 'preenche',
    base: () => ({ color: '#fff' }),
  };
  const est = estiloPalavra(preset, {
    estado: 'ativa', dtPalavra: 0.2, progresso: 0.5, cor: '#EE7533',
  });
  assert.match(est.backgroundImage, /50%/);
  assert.equal(est.WebkitBackgroundClip, 'text');
});

test('estiloPalavra combina base + destaque quando a palavra e palavra-chave', () => {
  const preset = {
    base: () => ({ color: '#fff' }),
    destaque: (cor) => ({ color: cor, fontWeight: 900 }),
  };
  const est = estiloPalavra(preset, { estado: 'futura', destaque: true, cor: '#EE7533' });
  assert.equal(est.color, '#EE7533');
  assert.equal(est.fontWeight, 900);
});

test('emojiDoBloco acha 💰 em "faturar"', () => {
  const bloco = { palavras: [p('vamos', 0, 0.2), p('faturar', 0.2, 0.6), p('muito', 0.6, 0.9)] };
  assert.equal(emojiDoBloco(bloco), '💰');
});

test('emojiDoBloco devolve null quando nenhuma palavra-gatilho aparece', () => {
  const bloco = { palavras: [p('oi', 0, 0.2), p('gente', 0.2, 0.5)] };
  assert.equal(emojiDoBloco(bloco), null);
});
