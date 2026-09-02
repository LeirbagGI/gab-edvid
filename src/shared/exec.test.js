import assert from 'node:assert/strict';
import test from 'node:test';
import { run } from './exec.js';

test('run mata o processo e rejeita com mensagem clara quando estoura o timeout', async () => {
  await assert.rejects(
    run('sleep', ['5'], { timeoutMs: 200 }),
    /tempo esgotado: sleep depois de/,
  );
});

test('run resolve normalmente quando o comando termina dentro do tempo', async () => {
  const saida = await run('echo', ['oi']);
  assert.match(saida, /oi/);
});
