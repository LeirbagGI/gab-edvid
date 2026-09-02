import { EventEmitter } from 'node:events';
import { rodarFase1, refazerCorte } from '../fase1/projeto.js';
import { rodarFase2 } from '../fase2/render.js';

/**
 * Fila serial de trabalhos.
 *
 * Roda um por vez de proposito: transcricao e render saturam a CPU, e dois
 * em paralelo ficam mais lentos que dois em sequencia. E o que permite jogar
 * dez videos na pasta e ir embora.
 */
class Fila extends EventEmitter {
  constructor() {
    super();
    this.itens = [];
    this.atual = null;
    this.seq = 0;
    this.rodando = false;
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
    this.emit('mudou', this.estado());
    this.puxar();
    return item;
  }

  cancelar(id) {
    const i = this.itens.findIndex((x) => x.id === id && x.status === 'na-fila');
    if (i === -1) return false;
    this.itens.splice(i, 1);
    this.emit('mudou', this.estado());
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
    if (!item) { this.atual = null; this.emit('mudou', this.estado()); return; }

    this.rodando = true;
    this.atual = item;
    item.status = 'rodando';
    item.iniciadoEm = new Date().toISOString();
    this.emit('mudou', this.estado());

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
    this.emit('mudou', this.estado());
    this.puxar();
  }
}

export const fila = new Fila();
