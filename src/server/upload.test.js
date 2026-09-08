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

/*
 * Regressao 08/09: o navegador manda o pedaco SEM Content-Type nenhum,
 * porque Blob.slice() nao herda o tipo do arquivo. Com `express.raw({ type:
 * '<curinga>' })` o body-parser consultava o type-is, que responde `false`
 * quando nao ha cabecalho de tipo — o parser era pulado, `req.body` chegava
 * `undefined` e todo pedaco morria em 400. Pior: o Express respondia o 400
 * enquanto o navegador ainda empurrava os 8 MB, a conexao era cortada no
 * meio e a tela dizia "rede caiu no pedaço 0", escondendo o erro de verdade.
 *
 * Este teste sobe a rota com o mesmo middleware do servidor e manda um PUT
 * sem Content-Type, que e exatamente o que o navegador faz.
 */
test('pedaço sem Content-Type nenhum é aceito e gravado', async () => {
  const express = (await import('express')).default;
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'edvid-up-ct-'));
  const { id } = iniciar({ nome: 'sem-tipo.mov', tamanho: 12 }, pasta);

  const app = express();
  app.put('/api/upload/:id/:indice', express.raw({ type: () => true, limit: '16mb' }), (req, res) => {
    try {
      res.json(receberPedaco(req.params.id, req.params.indice, req.body, pasta));
    } catch (e) {
      res.status(400).json({ erro: e.message });
    }
  });

  const servidor = app.listen(0);
  await new Promise((ok) => servidor.once('listening', ok));
  const base = `http://127.0.0.1:${servidor.address().port}`;

  // O `finally` nao e zelo: sem ele uma assercao que falha deixa o servidor
  // escutando, o processo do `node --test` nunca fecha e a suite trava em vez
  // de mostrar o erro.
  try {
    // `fetch` com Buffer nao manda Content-Type — igualzinho ao XHR com Blob fatiado.
    const r = await fetch(`${base}/api/upload/${id}/0`, { method: 'PUT', body: Buffer.from('doze bytes!!') });
    assert.equal(r.status, 200, 'pedaço sem Content-Type deveria ser aceito');
    assert.deepEqual((await r.json()).recebidos, [0]);
    assert.equal(
      fs.readFileSync(path.join(pasta, '.parciais', id, '0.part'), 'utf8'),
      'doze bytes!!',
      'o pedaço nao chegou inteiro no disco',
    );

    // Corpo vazio precisa dizer o que houve, nao vazar o erro cru do fs.
    const vazio = await fetch(`${base}/api/upload/${id}/1`, { method: 'PUT' });
    assert.equal(vazio.status, 400);
    assert.match((await vazio.json()).erro, /chegou vazio/);
  } finally {
    servidor.close();
    fs.rmSync(pasta, { recursive: true, force: true });
  }
});
