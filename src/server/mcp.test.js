import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import express from 'express';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { montarMcp, lerRegistro } from './mcp.js';
import { FERRAMENTAS } from './ferramentas.js';

/**
 * O MCP e a porta de entrada do Claude (via ponte) para as mesmas acoes dos
 * botoes. Aqui sobe um servidor de verdade, num projeto de mentira numa
 * pasta temporaria, e conversa com ele como o CLI conversaria: lista as
 * ferramentas, chama uma, confere o que ficou gravado.
 */

const PASTA = fs.mkdtempSync(path.join(os.tmpdir(), 'edvid-mcp-'));
const NOME = 'projeto-teste';

function caminhoProjeto(nome) {
  return path.join(PASTA, nome, 'projeto.json');
}

function carregar(nome) {
  const arq = caminhoProjeto(nome);
  if (!fs.existsSync(arq)) return null;
  return JSON.parse(fs.readFileSync(arq, 'utf8'));
}

function salvar(projeto) {
  const arq = caminhoProjeto(projeto.nome);
  fs.mkdirSync(path.dirname(arq), { recursive: true });
  fs.writeFileSync(arq, JSON.stringify(projeto, null, 2));
  return projeto;
}

function projetoMinimo() {
  return {
    nome: NOME,
    origem: { arquivo: 'bruto.mov', duracao: 30 },
    fase1: {
      status: 'pronta',
      duracao: 12.3,
      clipes: [
        { id: 'c1', texto: 'Primeira fala do vídeo', bloco: 'HOOK', ativo: true, origemInicio: 0, origemFim: 2, duracao: 2 },
        { id: 'c2', texto: 'Segunda fala do vídeo', bloco: 'DINAMICA', ativo: true, origemInicio: 2, origemFim: 4, duracao: 2 },
      ],
      descartados: [],
    },
    estilo: {
      tipoEdicao: 'limpa',
      corDestaque: '#EE7533',
      estiloHeadline: 'caixa-branca',
      estiloLegenda: 'karaoke',
      elementos: {
        movimentoTracking: false,
        automacaoZoomIn: true,
        zoomInOutNosCortes: true,
        trilhaSonoraComIA: true,
        flashNaTransicao: false,
      },
      observacoes: '',
    },
    fase2: {},
    conversa: [],
    chat: {},
  };
}

/** Sobe o express com montarMcp numa porta livre; devolve { url, fechar }. */
async function subirServidor() {
  const app = express();
  const trabalhosEnfileirados = [];
  const transmitidos = [];
  const fila = { enfileirar: (tipo, dados) => trabalhosEnfileirados.push({ tipo, ...dados }) };
  const transmitir = (msg) => transmitidos.push(msg);
  montarMcp(app, { carregar, salvar, transmitir, fila });

  const servidor = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const porta = servidor.address().port;
  return {
    porta,
    trabalhosEnfileirados,
    transmitidos,
    fechar: () => new Promise((resolve) => servidor.close(resolve)),
  };
}

test('lista as ferramentas e chama mudar_estilo pelo MCP', async () => {
  salvar(projetoMinimo());

  const { porta, transmitidos, fechar } = await subirServidor();
  const client = new Client({ name: 'edvid-teste', version: '1.0.0' });
  const transporte = new StreamableHTTPClientTransport(
    new URL(`http://127.0.0.1:${porta}/mcp/${encodeURIComponent(NOME)}`),
  );

  try {
    await client.connect(transporte);

    const { tools } = await client.listTools();
    assert.deepEqual(
      tools.map((t) => t.name).sort(),
      FERRAMENTAS.map((f) => f.name).sort(),
    );
    assert.equal(tools.length, FERRAMENTAS.length);

    const resultado = await client.callTool({
      name: 'mudar_estilo',
      arguments: { corDestaque: 'azul' },
    });
    assert.equal(resultado.isError, undefined);
    assert.match(resultado.content[0].text, /#2E7BEF/);

    const depois = carregar(NOME);
    assert.equal(depois.estilo.corDestaque, '#2E7BEF');

    const registro = lerRegistro(NOME);
    assert.equal(registro.length, 1);
    assert.equal(registro[0].ferramenta, 'mudar_estilo');

    assert.ok(transmitidos.some((m) => m.tipo === 'projeto'), 'deveria ter transmitido a mudanca pelo WS');
  } finally {
    await client.close();
    await fechar();
  }
});
