import assert from 'node:assert/strict';
import test from 'node:test';
import {
  editarPalavra, dividirPalavra, juntarPalavra, empurrarPalavra, validarConfigLegenda,
} from './legenda-edicao.js';

function clipesTeste() {
  return [
    {
      id: 'c1', inicio: 0, fim: 3,
      palavras: [
        { texto: 'Primeira', inicio: 0.1, fim: 0.6 },
        { texto: 'palavra', inicio: 0.6, fim: 1.1 },
        { texto: 'aqui', inicio: 1.1, fim: 1.5 },
      ],
    },
  ];
}

test('editarPalavra: muda texto, oculta e destaque so os campos mandados', () => {
  const clipes = clipesTeste();
  const p = editarPalavra(clipes, { clipe: 'c1', indice: 1, texto: 'segunda', oculta: true });
  assert.equal(p.texto, 'segunda');
  assert.equal(p.oculta, true);
  assert.equal(clipes[0].palavras[0].texto, 'Primeira'); // as outras nao mudam
});

test('editarPalavra: inicio >= fim rejeita', () => {
  const clipes = clipesTeste();
  assert.throws(() => editarPalavra(clipes, {
    clipe: 'c1', indice: 1, inicio: 1.0, fim: 0.9,
  }), /inicio precisa ser menor que fim/);
});

test('editarPalavra: inicio invadindo a anterior rejeita', () => {
  const clipes = clipesTeste();
  assert.throws(() => editarPalavra(clipes, { clipe: 'c1', indice: 1, inicio: 0.5 }), /invade a palavra anterior/);
});

test('editarPalavra: fim invadindo a seguinte rejeita', () => {
  const clipes = clipesTeste();
  assert.throws(() => editarPalavra(clipes, { clipe: 'c1', indice: 1, fim: 1.2 }), /invade a palavra seguinte/);
});

test('editarPalavra: clipe ou indice inexistente rejeita', () => {
  const clipes = clipesTeste();
  assert.throws(() => editarPalavra(clipes, { clipe: 'nope', indice: 0 }), /nao encontrado/);
  assert.throws(() => editarPalavra(clipes, { clipe: 'c1', indice: 9 }), /nao encontrada/);
});

test('dividirPalavra: divide o texto e reparte o tempo proporcional as letras', () => {
  const clipes = clipesTeste();
  // "palavra" (7 letras), inicio 0.6, fim 1.1 (0.5s). posicao 3 -> "pal"/"avra".
  const [a, b] = dividirPalavra(clipes, { clipe: 'c1', indice: 1, posicao: 3 });
  assert.equal(a.texto, 'pal');
  assert.equal(b.texto, 'avra');
  assert.equal(a.inicio, 0.6);
  assert.equal(b.fim, 1.1);
  assert.ok(Math.abs(a.fim - (0.6 + 0.5 * (3 / 7))) < 0.001);
  assert.equal(a.fim, b.inicio);
  assert.equal(clipes[0].palavras.length, 4);
});

test('dividirPalavra: posicao fora do texto rejeita', () => {
  const clipes = clipesTeste();
  assert.throws(() => dividirPalavra(clipes, { clipe: 'c1', indice: 1, posicao: 0 }), /posicao invalida/);
  assert.throws(() => dividirPalavra(clipes, { clipe: 'c1', indice: 1, posicao: 7 }), /posicao invalida/);
});

test('juntarPalavra: junta com a seguinte, soma texto e tempo', () => {
  const clipes = clipesTeste();
  const j = juntarPalavra(clipes, { clipe: 'c1', indice: 0 });
  assert.equal(j.texto, 'Primeira palavra');
  assert.equal(j.inicio, 0.1);
  assert.equal(j.fim, 1.1);
  assert.equal(clipes[0].palavras.length, 2);
});

test('juntarPalavra: sem palavra seguinte rejeita', () => {
  const clipes = clipesTeste();
  assert.throws(() => juntarPalavra(clipes, { clipe: 'c1', indice: 2 }), /nao ha palavra seguinte/);
});

test('empurrarPalavra: desloca so a palavra pedida, sem invadir a seguinte', () => {
  const clipes = clipesTeste();
  // As palavras de teste sao contiguas (fim de uma = inicio da seguinte);
  // so cabe deslocar para tras sem invadir.
  const [w] = empurrarPalavra(clipes, {
    clipe: 'c1', indice: 0, deltaS: -0.05, ateOFim: false,
  });
  assert.equal(w.inicio, 0.05);
  assert.equal(w.fim, 0.55);
  assert.equal(clipes[0].palavras[1].inicio, 0.6); // a seguinte nao mexeu
});

test('empurrarPalavra: invadir a seguinte sem ateOFim rejeita', () => {
  const clipes = clipesTeste();
  assert.throws(() => empurrarPalavra(clipes, {
    clipe: 'c1', indice: 0, deltaS: 0.6, ateOFim: false,
  }), /invade a palavra seguinte/);
});

test('empurrarPalavra: ateOFim desloca a palavra e todas as seguintes juntas', () => {
  const clipes = clipesTeste();
  const alvo = empurrarPalavra(clipes, {
    clipe: 'c1', indice: 1, deltaS: 0.3, ateOFim: true,
  });
  assert.equal(alvo.length, 2);
  assert.equal(clipes[0].palavras[1].inicio, 0.9);
  assert.equal(clipes[0].palavras[2].fim, 1.8);
});

test('empurrarPalavra: ateOFim que ultrapassa o fim do clipe rejeita', () => {
  const clipes = clipesTeste();
  assert.throws(() => empurrarPalavra(clipes, {
    clipe: 'c1', indice: 1, deltaS: 2, ateOFim: true,
  }), /ultrapassa o fim do clipe/);
});

test('empurrarPalavra: deltaS zero ou nao numerico rejeita', () => {
  const clipes = clipesTeste();
  assert.throws(() => empurrarPalavra(clipes, { clipe: 'c1', indice: 0, deltaS: 0 }), /diferente de zero/);
});

test('validarConfigLegenda: aceita objeto vazio e valores dentro da faixa', () => {
  assert.deepEqual(validarConfigLegenda({}), []);
  assert.deepEqual(validarConfigLegenda({
    posicao: 'meio', escala: 1.2, alinhamento: 'esquerda', maiusculas: true, antecedencia: 0.2, maxPalavras: 3,
  }), []);
});

test('validarConfigLegenda: rejeita fora da faixa e enum invalido', () => {
  assert.ok(validarConfigLegenda({ posicao: 'centro' }).length > 0);
  assert.ok(validarConfigLegenda({ escala: 2 }).length > 0);
  assert.ok(validarConfigLegenda({ alinhamento: 'direita' }).length > 0);
  assert.ok(validarConfigLegenda({ antecedencia: 0.5 }).length > 0);
  assert.ok(validarConfigLegenda({ maxPalavras: 0 }).length > 0);
  assert.ok(validarConfigLegenda({ maxPalavras: 7 }).length > 0);
  assert.ok(validarConfigLegenda({ maiusculas: 'sim' }).length > 0);
});
