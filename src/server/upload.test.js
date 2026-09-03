import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  iniciar, receberPedaco, estado, finalizar, limparVelhos,
} from './upload.js';

/**
 * Upload em pedaços: sessão em disco, pedaços fora de ordem, reenvio
 * idempotente, e erro claro quando falta pedaço na hora de montar.
 *
 * Toda função aceita a pasta de entrada como último argumento — aqui é uma
 * pasta temporária, nunca a pasta real do Gabriel.
 */

function pastaTemp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'edvid-upload-'));
}

test('inicia, recebe pedaços fora de ordem, e finaliza com bytes idênticos ao original', () => {
  const pasta = pastaTemp();
  process.env.EDVID_PEDACO_MB = '1'; // pedaço pequeno para o teste nao gerar arquivo gigante

  const original = crypto.randomBytes(2.5 * 1024 * 1024); // 3 pedacos de 1MB (2 inteiros + 1 parcial)
  const { id, tamanhoPedaco } = iniciar({ nome: 'video.mp4', tamanho: original.length, tipo: 'video/mp4' }, pasta);
  assert.equal(tamanhoPedaco, 1024 * 1024);

  const pedacos = [];
  for (let i = 0; i < original.length; i += tamanhoPedaco) {
    pedacos.push(original.subarray(i, i + tamanhoPedaco));
  }
  assert.equal(pedacos.length, 3);

  // Fora de ordem: 2, 0, 1.
  receberPedaco(id, 2, pedacos[2], pasta);
  receberPedaco(id, 0, pedacos[0], pasta);
  receberPedaco(id, 1, pedacos[1], pasta);

  const e = estado(id, pasta);
  assert.deepEqual(e.recebidos, [0, 1, 2]);
  assert.equal(e.total, 3);

  const { caminho } = finalizar(id, pasta);
  assert.ok(fs.existsSync(caminho));
  assert.equal(path.basename(caminho), 'video.mp4');

  const montado = fs.readFileSync(caminho);
  assert.equal(montado.length, original.length);
  assert.equal(
    crypto.createHash('sha256').update(montado).digest('hex'),
    crypto.createHash('sha256').update(original).digest('hex'),
    'sha256 do arquivo montado deveria bater com o original',
  );

  // Os parciais somem depois de finalizar.
  assert.ok(!fs.existsSync(path.join(pasta, '.parciais', id)));

  delete process.env.EDVID_PEDACO_MB;
});

test('pedaço repetido não duplica: reenviar o mesmo índice sobrescreve', () => {
  const pasta = pastaTemp();
  process.env.EDVID_PEDACO_MB = '1';

  const original = crypto.randomBytes(1024 * 1024);
  const { id } = iniciar({ nome: 'clip.mov', tamanho: original.length }, pasta);

  receberPedaco(id, 0, original, pasta);
  receberPedaco(id, 0, original, pasta); // reenvio do mesmo pedaco (retomada)
  receberPedaco(id, 0, original, pasta);

  const e = estado(id, pasta);
  assert.deepEqual(e.recebidos, [0], 'nao deveria contar o pedaco 0 mais de uma vez');

  const { caminho } = finalizar(id, pasta);
  assert.equal(fs.readFileSync(caminho).length, original.length);

  delete process.env.EDVID_PEDACO_MB;
});

test('finalizar com pedaço faltando dá erro claro', () => {
  const pasta = pastaTemp();
  process.env.EDVID_PEDACO_MB = '1';

  const original = crypto.randomBytes(2.5 * 1024 * 1024);
  const { id } = iniciar({ nome: 'falho.mp4', tamanho: original.length }, pasta);

  // So manda o pedaco 0 e o 2 — falta o 1.
  receberPedaco(id, 0, original.subarray(0, 1024 * 1024), pasta);
  receberPedaco(id, 2, original.subarray(2 * 1024 * 1024), pasta);

  assert.throws(
    () => finalizar(id, pasta),
    /falta o pedaço 2 de 3/,
  );

  delete process.env.EDVID_PEDACO_MB;
});

test('receberPedaco recusa sessao que nao existe', () => {
  const pasta = pastaTemp();
  assert.throws(
    () => receberPedaco('id-inventado', 0, Buffer.from('x'), pasta),
    /sess[aã]o "id-inventado" n[aã]o encontrada/,
  );
});

test('limparVelhos apaga sessao mais velha que o limite e mantem a recente', () => {
  const pasta = pastaTemp();
  const { id: velho } = iniciar({ nome: 'a.mp4', tamanho: 100 }, pasta);
  const { id: novo } = iniciar({ nome: 'b.mp4', tamanho: 100 }, pasta);

  const arqVelho = path.join(pasta, '.parciais', velho, 'estado.json');
  const antigo = new Date(Date.now() - 48 * 3600 * 1000);
  fs.utimesSync(arqVelho, antigo, antigo);

  const removidos = limparVelhos(24, pasta);
  assert.equal(removidos, 1);
  assert.ok(!fs.existsSync(path.join(pasta, '.parciais', velho)));
  assert.ok(fs.existsSync(path.join(pasta, '.parciais', novo)));
});
