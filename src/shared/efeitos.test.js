import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TRANSICOES, EFEITOS, INTRO_PADRAO, ANIMACOES_INTRO,
  acharTransicao, acharEfeito, transicaoPadrao, efeitosPadrao,
} from './efeitos.js';

test('transicoes tem id unico, nome e duracao numerica', () => {
  const ids = TRANSICOES.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length, `ids repetidos: ${ids.join(', ')}`);
  for (const t of TRANSICOES) {
    assert.equal(typeof t.nome, 'string');
    assert.ok(t.nome.length > 0, `${t.id}: nome vazio`);
    assert.equal(typeof t.duracao, 'number');
    assert.ok(t.duracao >= 0, `${t.id}: duracao negativa`);
    assert.equal(typeof t.descricao, 'string');
  }
});

test('as 12 transicoes do PRD (E) existem', () => {
  const esperadas = [
    'corte', 'crossfade', 'dip-preto', 'dip-branco', 'flash', 'zoom-punch',
    'whip-esquerda', 'whip-direita', 'slide-cima', 'slide-baixo', 'blur', 'glitch',
  ];
  const ids = new Set(TRANSICOES.map((t) => t.id));
  for (const id of esperadas) assert.ok(ids.has(id), `transicao "${id}" nao existe`);
  assert.equal(TRANSICOES.length, esperadas.length);
});

test('corte tem duracao zero, flash mantem os 0,13s de hoje', () => {
  assert.equal(acharTransicao('corte').duracao, 0);
  assert.equal(acharTransicao('flash').duracao, 0.13);
});

test('acharTransicao com id desconhecido cai no default (corte)', () => {
  const t = acharTransicao('nao-existe');
  assert.equal(t.id, 'corte');
});

test('acharTransicao sem id cai no default (corte)', () => {
  assert.equal(acharTransicao(undefined).id, 'corte');
});

test('efeitos tem id unico, nome, escopo valido e parametros.intensidade', () => {
  const ids = EFEITOS.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length, `ids repetidos: ${ids.join(', ')}`);
  for (const e of EFEITOS) {
    assert.equal(typeof e.nome, 'string');
    assert.ok(['projeto', 'clipe'].includes(e.escopo), `${e.id}: escopo invalido "${e.escopo}"`);
    assert.deepEqual(e.parametros.intensidade, [0, 1]);
  }
});

test('os efeitos do PRD (E) existem, congelar e por clipe', () => {
  const esperados = ['grao', 'vinheta', 'shake', 'blur-fundo', 'barra-progresso', 'letterbox'];
  const ids = new Set(EFEITOS.map((e) => e.id));
  for (const id of esperados) assert.ok(ids.has(id), `efeito "${id}" nao existe`);
  assert.equal(acharEfeito('congelar').escopo, 'clipe');
});

test('acharEfeito com id desconhecido devolve null', () => {
  assert.equal(acharEfeito('nao-existe'), null);
});

test('INTRO_PADRAO e ANIMACOES_INTRO tem a forma documentada', () => {
  assert.equal(INTRO_PADRAO.duracao, 2.5);
  assert.equal(INTRO_PADRAO.animacao, 'zoom-lento');
  assert.deepEqual(ANIMACOES_INTRO, ['zoom-lento', 'fade', 'slide']);
});

test('transicaoPadrao(): sem estilo nenhum vira corte', () => {
  assert.deepEqual(transicaoPadrao(undefined), { tipo: 'corte', duracao: 0 });
  assert.deepEqual(transicaoPadrao({}), { tipo: 'corte', duracao: 0 });
});

test('transicaoPadrao(): elementos.flashNaTransicao vira flash, sem estilo.transicao', () => {
  const r = transicaoPadrao({ elementos: { flashNaTransicao: true } });
  assert.deepEqual(r, { tipo: 'flash', duracao: 0.13 });
});

test('transicaoPadrao(): estilo.transicao manda mais que flashNaTransicao', () => {
  const r = transicaoPadrao({
    elementos: { flashNaTransicao: true },
    transicao: { tipo: 'zoom-punch' },
  });
  assert.deepEqual(r, { tipo: 'zoom-punch', duracao: 0.3 });
});

test('transicaoPadrao(): estilo.transicao com duracao propria sobrescreve a do catalogo', () => {
  const r = transicaoPadrao({ transicao: { tipo: 'crossfade', duracao: 0.8 } });
  assert.deepEqual(r, { tipo: 'crossfade', duracao: 0.8 });
});

test('efeitosPadrao() e um objeto vazio, e cada chamada devolve uma instancia nova', () => {
  const a = efeitosPadrao();
  const b = efeitosPadrao();
  assert.deepEqual(a, {});
  assert.notEqual(a, b);
});
