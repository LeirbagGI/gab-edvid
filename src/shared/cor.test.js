import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AJUSTES_PADRAO, LUTS, corPadrao, montarFiltroCor, validarCor, escaparCaminhoLut,
} from './cor.js';

test('cor padrao monta filtro vazio', () => {
  assert.equal(montarFiltroCor(corPadrao(), { pastaLuts: '/luts' }), '');
});

test('so LUT monta so o lut3d', () => {
  const cor = { lut: 'teal-orange', intensidade: 1, ajustes: { ...AJUSTES_PADRAO } };
  const filtro = montarFiltroCor(cor, { pastaLuts: '/opt/edvid/luts' });
  assert.equal(filtro, "lut3d=file='/opt/edvid/luts/teal-orange.cube':interp=tetrahedral");
});

test('LUT com intensidade 0 nao entra na cadeia', () => {
  const cor = { lut: 'teal-orange', intensidade: 0, ajustes: { ...AJUSTES_PADRAO } };
  assert.equal(montarFiltroCor(cor, { pastaLuts: '/luts' }), '');
});

test('so ajuste de contraste monta so o eq', () => {
  const cor = { lut: null, intensidade: 1, ajustes: { ...AJUSTES_PADRAO, contraste: 1.2 } };
  const filtro = montarFiltroCor(cor, { pastaLuts: '/luts' });
  assert.equal(filtro, 'eq=brightness=0:contrast=1.2:saturation=1:gamma=1');
});

test('combinacao completa sai na ordem certa: lut, eq, temperatura, tint, exposicao, vinheta', () => {
  const cor = {
    lut: 'vivido',
    intensidade: 1,
    ajustes: {
      ...AJUSTES_PADRAO,
      contraste: 1.15,
      temperatura: 20,
      tint: -10,
      exposicao: 0.5,
      vinheta: 0.4,
    },
  };
  const filtro = montarFiltroCor(cor, { pastaLuts: '/luts' });
  const partes = filtro.split(',');
  assert.equal(partes.length, 6);
  assert.match(partes[0], /^lut3d=file='\/luts\/vivido\.cube':interp=tetrahedral$/);
  assert.match(partes[1], /^eq=brightness=0:contrast=1\.15:saturation=1:gamma=1$/);
  assert.equal(partes[2], 'colortemperature=temperature=7100');
  assert.equal(partes[3], 'colorbalance=gm=0.1');
  assert.equal(partes[4], 'exposure=exposure=0.5');
  assert.equal(partes[5], 'vignette=angle=PI/5');
});

test('vinheta 0 nao entra na cadeia mesmo com outros ajustes', () => {
  const cor = { lut: null, intensidade: 1, ajustes: { ...AJUSTES_PADRAO, vinheta: 0 } };
  assert.equal(montarFiltroCor(cor, { pastaLuts: '/luts' }), '');
});

test('LUT desconhecida nao entra silenciosamente na cadeia', () => {
  const cor = { lut: 'nao-existe', intensidade: 1, ajustes: { ...AJUSTES_PADRAO } };
  assert.equal(montarFiltroCor(cor, { pastaLuts: '/luts' }), '');
});

test('escapa apostrofo e barra invertida do caminho do LUT', () => {
  assert.equal(escaparCaminhoLut("/pastas/O'Brien/x.cube"), "/pastas/O'\\''Brien/x.cube");
  assert.equal(escaparCaminhoLut('C:\\pastas\\x.cube'), 'C:\\\\pastas\\\\x.cube');
});

test('validarCor: padrao passa', () => {
  const r = validarCor(corPadrao());
  assert.equal(r.ok, true);
  assert.deepEqual(r.erros, []);
});

test('validarCor: aceita as 12 LUTs conhecidas', () => {
  for (const l of LUTS) {
    const r = validarCor({ lut: l.id });
    assert.equal(r.ok, true, `${l.id} deveria ser valida`);
  }
  assert.equal(LUTS.length, 12);
});

test('validarCor: reprova LUT desconhecida', () => {
  const r = validarCor({ lut: 'inventada' });
  assert.equal(r.ok, false);
  assert.match(r.erros[0], /LUT desconhecida/);
});

test('validarCor: reprova intensidade fora de 0 ou 1', () => {
  const r = validarCor({ intensidade: 0.5 });
  assert.equal(r.ok, false);
  assert.match(r.erros[0], /intensidade/);
});

test('validarCor: reprova ajuste fora da faixa', () => {
  const r = validarCor({ ajustes: { contraste: 5, saturacao: -1 } });
  assert.equal(r.ok, false);
  assert.equal(r.erros.length, 2);
});

test('validarCor: reprova ajuste desconhecido', () => {
  const r = validarCor({ ajustes: { brilhozao: 1 } });
  assert.equal(r.ok, false);
  assert.match(r.erros[0], /desconhecido/);
});

test('validarCor: aceita valores nos limites exatos da faixa', () => {
  const r = validarCor({
    ajustes: {
      exposicao: -2, contraste: 2, saturacao: 0, temperatura: -100,
      tint: 100, brilho: -0.5, gama: 2, vinheta: 1,
    },
  });
  assert.equal(r.ok, true, r.erros.join('; '));
});
