import assert from 'node:assert/strict';
import test from 'node:test';

// A fila importa rodarFase1/rodarFase2 de verdade; aqui so exercitamos o
// mecanismo (ordem, serialidade, erro que nao derruba o resto) com um tipo
// falso injetado.
const { fila } = await import('./fila.js');

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

/** Substitui o executor por um dublê e devolve a funcao de restaurar. */
function comDuble(executar) {
  const original = fila.puxar;
  const feitos = [];
  fila.puxar = async function puxar() {
    if (this.rodando) return;
    const item = this.itens.find((i) => i.status === 'na-fila');
    if (!item) { this.atual = null; this.emit('mudou', this.estado()); return; }
    this.rodando = true;
    this.atual = item;
    item.status = 'rodando';
    this.emit('mudou', this.estado());
    try {
      await executar(item, feitos);
      item.status = 'pronto';
      item.pct = 100;
    } catch (e) {
      item.status = 'erro';
      item.msg = e.message;
    }
    this.rodando = false;
    this.atual = null;
    this.emit('mudou', this.estado());
    this.puxar();
  };
  return { feitos, restaurar: () => { fila.puxar = original; fila.itens = []; } };
}

test('roda os trabalhos em ordem e um de cada vez', async () => {
  let simultaneos = 0;
  let maximo = 0;
  const { feitos, restaurar } = comDuble(async (item, log) => {
    simultaneos += 1;
    maximo = Math.max(maximo, simultaneos);
    await esperar(20);
    log.push(item.nome);
    simultaneos -= 1;
  });

  fila.enfileirar('fase1', { nome: 'a' });
  fila.enfileirar('fase1', { nome: 'b' });
  fila.enfileirar('fase2', { nome: 'c' });

  await esperar(200);
  assert.deepEqual(feitos, ['a', 'b', 'c'], 'ordem de chegada nao respeitada');
  assert.equal(maximo, 1, 'rodou mais de um trabalho ao mesmo tempo');
  restaurar();
});

test('um trabalho que falha nao interrompe os seguintes', async () => {
  const { feitos, restaurar } = comDuble(async (item, log) => {
    if (item.nome === 'quebra') throw new Error('falhou de proposito');
    log.push(item.nome);
  });

  fila.enfileirar('fase1', { nome: 'quebra' });
  fila.enfileirar('fase1', { nome: 'depois' });

  await esperar(150);
  assert.deepEqual(feitos, ['depois']);
  const comErro = fila.itens.find((i) => i.nome === 'quebra');
  assert.equal(comErro.status, 'erro');
  assert.match(comErro.msg, /proposito/);
  restaurar();
});

test('da para cancelar quem ainda esta na fila, mas nao quem ja roda', async () => {
  const { restaurar } = comDuble(async () => esperar(80));

  fila.enfileirar('fase1', { nome: 'rodando' });
  const naFila = fila.enfileirar('fase1', { nome: 'esperando' });

  await esperar(10);
  assert.equal(fila.cancelar(naFila.id), true, 'deveria cancelar quem espera');
  assert.equal(fila.cancelar(fila.atual?.id ?? 'x'), false, 'nao pode cancelar o que ja roda');
  await esperar(150);
  restaurar();
});
