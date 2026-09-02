import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { rodarFase1, refazerCorte } from '../fase1/projeto.js';
import { rodarFase2 } from '../fase2/render.js';
import { RAIZ } from '../shared/config.js';

/**
 * Fila serial de trabalhos.
 *
 * Roda um por vez de proposito: transcricao e render saturam a CPU, e dois
 * em paralelo ficam mais lentos que dois em sequencia. E o que permite jogar
 * dez videos na pasta e ir embora.
 *
 * Persiste em disco a cada mudanca (fila.json por padrao), porque na VPS o
 * container pode reiniciar (deploy, OOM) com trabalho pendente. O construtor
 * so recarrega o que sobrou; quem decide quando comecar a puxar de novo e
 * quem monta o servidor, chamando retomar() depois de registrar os
 * executores e os listeners do WebSocket.
 */
class Fila extends EventEmitter {
  constructor({ arquivo } = {}) {
    super();
    this.arquivo = arquivo || path.join(RAIZ, 'fila.json');
    this.itens = [];
    this.atual = null;
    this.seq = 0;
    this.rodando = false;
    this.carregar();
  }

  /** Le o que sobrou de uma execucao anterior, se houver. Nao dispara nada. */
  carregar() {
    if (!fs.existsSync(this.arquivo)) return;
    let dados;
    try {
      dados = JSON.parse(fs.readFileSync(this.arquivo, 'utf8'));
    } catch {
      return; // arquivo corrompido: comeca vazio em vez de travar o boot
    }

    const recuperados = [];
    // O que estava rodando quando o processo caiu volta na frente da fila,
    // com um recado — quem estava esperando continua esperando atras dele.
    if (dados.atual) {
      recuperados.push({
        ...dados.atual,
        status: 'na-fila',
        msg: 'retomado depois de reinício',
      });
    }
    if (Array.isArray(dados.fila)) {
      recuperados.push(...dados.fila.map((i) => ({ ...i, status: 'na-fila' })));
    }

    this.itens = recuperados;
    this.seq = recuperados.reduce((max, i) => {
      const n = Number(String(i.id ?? '').replace(/^t/, ''));
      return Number.isFinite(n) ? Math.max(max, n) : max;
    }, 0);
  }

  /**
   * Grava { fila, atual } de forma atomica (escreve em .tmp e renomeia).
   * Melhor esforco: se a pasta ainda nao existe (Mac do Gabriel sem
   * EDVID_RAIZ configurado), a fila segue funcionando so em memoria.
   */
  persistir() {
    try {
      const tmp = `${this.arquivo}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({
        fila: this.itens.filter((i) => i.status === 'na-fila'),
        atual: this.atual,
      }, null, 2));
      fs.renameSync(tmp, this.arquivo);
    } catch {
      // sem persistencia disponivel — nao derruba o trabalho por causa disso
    }
  }

  /** Emite o evento de sempre e persiste em disco. */
  notificar() {
    this.emit('mudou', this.estado());
    this.persistir();
  }

  /**
   * Comeca a puxar o que foi recuperado do disco no construtor. Quem monta o
   * servidor chama isso depois de registrar os executores.
   */
  retomar() {
    this.puxar();
  }

  /** tipo: 'fase1' | 'fase2' | 'refazer' */
  enfileirar(tipo, dados) {
    const item = {
      id: `t${++this.seq}`,
      tipo,
      ...dados,
      status: 'na-fila',
      criadoEm: new Date().toISOString(),
      etapa: '',
      msg: 'aguardando na fila',
      pct: 0,
    };
    this.itens.push(item);
    this.notificar();
    this.puxar();
    return item;
  }

  cancelar(id) {
    const i = this.itens.findIndex((x) => x.id === id && x.status === 'na-fila');
    if (i === -1) return false;
    this.itens.splice(i, 1);
    this.notificar();
    return true;
  }

  estado() {
    return {
      atual: this.atual,
      fila: this.itens.filter((i) => i.status === 'na-fila'),
      feitos: this.itens.filter((i) => ['pronto', 'erro'].includes(i.status)).slice(-12),
    };
  }

  async puxar() {
    if (this.rodando) return;
    const item = this.itens.find((i) => i.status === 'na-fila');
    if (!item) { this.atual = null; this.notificar(); return; }

    this.rodando = true;
    this.atual = item;
    item.status = 'rodando';
    item.iniciadoEm = new Date().toISOString();
    this.notificar();

    const log = (d) => {
      item.etapa = d.etapa ?? item.etapa;
      item.msg = d.msg ?? item.msg;
      item.pct = d.pct ?? (d.etapa ? 0 : item.pct);
      this.emit('progresso', { ...item });
    };

    try {
      if (item.tipo === 'fase1') {
        const p = await rodarFase1(item.arquivo, item.nome, { log });
        item.projeto = p.nome;
      } else if (item.tipo === 'refazer') {
        await refazerCorte(item.nome, { log });
      } else if (item.tipo === 'fase2') {
        await rodarFase2(item.nome, { log });
      } else {
        throw new Error(`tipo de trabalho desconhecido: ${item.tipo}`);
      }
      item.status = 'pronto';
      item.pct = 100;
    } catch (e) {
      item.status = 'erro';
      item.msg = e.message;
    }

    item.terminadoEm = new Date().toISOString();
    this.rodando = false;
    this.atual = null;
    this.notificar();
    this.puxar();
  }
}

export { Fila };
export const fila = new Fila();
