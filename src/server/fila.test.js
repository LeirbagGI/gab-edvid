import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// A fila importa rodarFase1/rodarFase2 de verdade; aqui so exercitamos o
// mecanismo (ordem, serialidade, erro que nao derruba o resto) com um tipo
// falso injetado.
const { fila, Fila } = await import('./fila.js');

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

// --------------------------------------------------------- persistencia

/** Mesmo dublê de cima, mas instalado numa Fila nova (nao no singleton),
 * apontando para um arquivo em os.tmpdir(). O executor nunca termina —
 * so precisamos ver o estado gravado antes/depois do reinicio. */
function comDubleEm(instancia, executar) {
  instancia.puxar = async function puxar() {
    if (this.rodando) return;
    const item = this.itens.find((i) => i.status === 'na-fila');
    if (!item) { this.atual = null; this.notificar(); return; }
    this.rodando = true;
    this.atual = item;
    item.status = 'rodando';
    this.notificar();
    try {
      await executar(item);
      item.status = 'pronto';
      item.pct = 100;
    } catch (e) {
      item.status = 'erro';
      item.msg = e.message;
    }
    this.rodando = false;
    this.atual = null;
    this.notificar();
    this.puxar();
  };
}

const arquivoTemp = (sufixo) => path.join(os.tmpdir(), `edvid-fila-teste-${Date.now()}-${sufixo}.json`);
const nuncaTermina = () => new Promise(() => {});

test('persiste os itens da fila no arquivo antes de rodar', async () => {
  const arquivo = arquivoTemp('a');
  const f = new Fila({ arquivo });
  comDubleEm(f, nuncaTermina);

  f.enfileirar('fase1', { nome: 'x' });
  f.enfileirar('fase1', { nome: 'y' });

  const gravado = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  const nomes = [gravado.atual, ...gravado.fila].filter(Boolean).map((i) => i.nome).sort();
  assert.deepEqual(nomes, ['x', 'y']);

  fs.unlinkSync(arquivo);
});

test('uma fila nova apontando para o mesmo arquivo recupera os itens na mesma ordem', async () => {
  const arquivo = arquivoTemp('b');
  const f1 = new Fila({ arquivo });
  comDubleEm(f1, nuncaTermina);

  f1.enfileirar('fase1', { nome: 'primeiro' });
  f1.enfileirar('fase1', { nome: 'segundo' });

  const f2 = new Fila({ arquivo });
  assert.deepEqual(f2.itens.map((i) => i.nome), ['primeiro', 'segundo']);
  assert.ok(f2.itens.every((i) => i.status === 'na-fila'), 'itens recuperados devem estar na-fila');
  assert.equal(f2.rodando, false, 'construtor nao pode comecar a rodar sozinho');

  fs.unlinkSync(arquivo);
});

test('o item que estava rodando volta na frente, marcado como retomado', async () => {
  const arquivo = arquivoTemp('c');
  const f1 = new Fila({ arquivo });
  comDubleEm(f1, nuncaTermina);

  f1.enfileirar('fase1', { nome: 'em-andamento' });
  f1.enfileirar('fase1', { nome: 'espera' });

  const f2 = new Fila({ arquivo });
  assert.equal(f2.itens[0].nome, 'em-andamento');
  assert.equal(f2.itens[0].status, 'na-fila');
  assert.equal(f2.itens[0].msg, 'retomado depois de reinício');
  assert.equal(f2.itens[1].nome, 'espera');

  fs.unlinkSync(arquivo);
});
