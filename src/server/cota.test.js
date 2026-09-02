import assert from 'node:assert/strict';
import test from 'node:test';
import { cota, temCota } from './cerebro.js';
import { LIMITE_CHAT } from '../shared/config.js';

/**
 * A cota existe porque cada mensagem no modo Claude custa tokens. Estes testes
 * fixam o contrato: conta certo, trava no limite e nao trava antes.
 */

test('projeto novo comeca com a cota cheia', () => {
  assert.deepEqual(cota({}), { usadas: 0, limite: LIMITE_CHAT, restam: LIMITE_CHAT });
  assert.equal(temCota({}), true);
});

test('a cota diminui conforme o uso', () => {
  assert.equal(cota({ chat: { usadas: 7 } }).restam, LIMITE_CHAT - 7);
  assert.equal(temCota({ chat: { usadas: LIMITE_CHAT - 1 } }), true, 'ainda restava uma');
});

test('trava exatamente no limite, nao antes', () => {
  assert.equal(temCota({ chat: { usadas: LIMITE_CHAT } }), false);
  assert.equal(cota({ chat: { usadas: LIMITE_CHAT } }).restam, 0);
});

test('uso acima do limite nao vira numero negativo', () => {
  assert.equal(cota({ chat: { usadas: LIMITE_CHAT + 5 } }).restam, 0);
  assert.equal(temCota({ chat: { usadas: LIMITE_CHAT + 5 } }), false);
});
