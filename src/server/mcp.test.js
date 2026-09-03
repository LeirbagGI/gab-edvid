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
import { dividirPalavra, juntarPalavra } from './legenda-edicao.js';

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
        {
          id: 'c1',
          texto: 'Primeira fala do vídeo',
          bloco: 'HOOK',
          ativo: true,
          origemInicio: 0,
          origemFim: 2,
          duracao: 2,
          palavras: [
            { texto: 'Primeira', inicio: 0, fim: 0.4 },
            { texto: 'fala', inicio: 0.4, fim: 0.7 },
            { texto: 'do', inicio: 0.7, fim: 0.85 },
            { texto: 'faturamento', inicio: 0.85, fim: 1.3 },
          ],
        },
        {
          id: 'c2',
          texto: 'Segunda fala do vídeo',
          bloco: 'DINAMICA',
          ativo: true,
          origemInicio: 2,
          origemFim: 4,
          duracao: 2,
          palavras: [
            { texto: 'Segunda', inicio: 2, fim: 2.4 },
            { texto: 'fala', inicio: 2.4, fim: 2.7 },
          ],
        },
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

test('FERRAMENTAS.length inclui as 8 ferramentas novas da API-2', () => {
  const nomes = new Set(FERRAMENTAS.map((f) => f.name));
  const novas = [
    'mudar_transicao', 'ligar_efeito', 'definir_intro', 'tirar_intro',
    'configurar_legenda', 'destacar_palavras', 'editar_palavra', 'exportar_legenda',
  ];
  for (const n of novas) assert.ok(nomes.has(n), `falta a ferramenta ${n}`);
  assert.equal(FERRAMENTAS.length, 20);
});

test('mudar_transicao pelo MCP: global e por clipe', async () => {
  salvar(projetoMinimo());
  const { porta, fechar } = await subirServidor();
  const client = new Client({ name: 'edvid-teste', version: '1.0.0' });
  const transporte = new StreamableHTTPClientTransport(
    new URL(`http://127.0.0.1:${porta}/mcp/${encodeURIComponent(NOME)}`),
  );
  try {
    await client.connect(transporte);

    const global = await client.callTool({ name: 'mudar_transicao', arguments: { tipo: 'crossfade' } });
    assert.equal(global.isError, undefined);
    let depois = carregar(NOME);
    assert.equal(depois.estilo.transicao.tipo, 'crossfade');

    const porClipe = await client.callTool({
      name: 'mudar_transicao',
      arguments: { tipo: 'flash', clipe: 'c2' },
    });
    assert.equal(porClipe.isError, undefined);
    depois = carregar(NOME);
    assert.equal(depois.fase1.clipes.find((c) => c.id === 'c2').transicao.tipo, 'flash');
    // A global nao devia ter mudado so por causa da chamada por clipe.
    assert.equal(depois.estilo.transicao.tipo, 'crossfade');

    const invalida = await client.callTool({ name: 'mudar_transicao', arguments: { clipe: 'c9', tipo: 'flash' } });
    assert.match(invalida.content[0].text, /Não existe o clipe/);
  } finally {
    await client.close();
    await fechar();
  }
});

test('destacar_palavras pelo MCP: marca nos dois clipes, ignorando acento e caixa', async () => {
  salvar(projetoMinimo());
  const { porta, fechar } = await subirServidor();
  const client = new Client({ name: 'edvid-teste', version: '1.0.0' });
  const transporte = new StreamableHTTPClientTransport(
    new URL(`http://127.0.0.1:${porta}/mcp/${encodeURIComponent(NOME)}`),
  );
  try {
    await client.connect(transporte);

    const r = await client.callTool({
      name: 'destacar_palavras',
      arguments: { palavras: ['FATURAMENTO', 'segunda'] },
    });
    assert.equal(r.isError, undefined);
    assert.match(r.content[0].text, /Destaquei 2/);

    const depois = carregar(NOME);
    const c1 = depois.fase1.clipes.find((c) => c.id === 'c1');
    const c2 = depois.fase1.clipes.find((c) => c.id === 'c2');
    assert.equal(c1.palavras.find((p) => p.texto === 'faturamento').destaque, true);
    assert.equal(c2.palavras.find((p) => p.texto === 'Segunda').destaque, true);
    assert.ok(!c1.palavras.find((p) => p.texto === 'fala').destaque);
  } finally {
    await client.close();
    await fechar();
  }
});

test('configurar_legenda pelo MCP: grava so os campos pedidos em estilo.legenda', async () => {
  salvar(projetoMinimo());
  const { porta, fechar } = await subirServidor();
  const client = new Client({ name: 'edvid-teste', version: '1.0.0' });
  const transporte = new StreamableHTTPClientTransport(
    new URL(`http://127.0.0.1:${porta}/mcp/${encodeURIComponent(NOME)}`),
  );
  try {
    await client.connect(transporte);

    const r = await client.callTool({
      name: 'configurar_legenda',
      arguments: { posicao: 'meio', maxPalavras: 3 },
    });
    assert.equal(r.isError, undefined);

    const depois = carregar(NOME);
    assert.deepEqual(depois.estilo.legenda, { posicao: 'meio', maxPalavras: 3 });

    const invalida = await client.callTool({ name: 'configurar_legenda', arguments: { escala: 5 } });
    assert.match(invalida.content[0].text, /Não consegui configurar/);
  } finally {
    await client.close();
    await fechar();
  }
});

/*
 * As rotas de palavras (dividir/juntar) sao HTTP puro em index.js, e
 * index.js nao e importavel em teste (sobe o servidor de verdade, o
 * WebSocket e o watcher de arquivos como efeito colateral do import). Aqui
 * sobe um express de mentira que registra as MESMAS chamadas as funcoes
 * puras de legenda-edicao.js que a rota real usa — cobre o contrato HTTP
 * (corpo, status, resposta) sem depender do processo do servidor inteiro.
 */
async function subirServidorPalavras() {
  const app = express();
  app.use(express.json());
  app.post('/api/projeto/:nome/palavras/dividir', (req, res) => {
    const p = carregar(req.params.nome);
    if (!p) return res.status(404).json({ erro: 'projeto nao encontrado' });
    try {
      const palavras = dividirPalavra(p.fase1.clipes, req.body || {});
      salvar(p);
      res.json({ palavras });
    } catch (e) {
      res.status(400).json({ erro: e.message });
    }
    return undefined;
  });
  app.post('/api/projeto/:nome/palavras/juntar', (req, res) => {
    const p = carregar(req.params.nome);
    if (!p) return res.status(404).json({ erro: 'projeto nao encontrado' });
    try {
      const palavra = juntarPalavra(p.fase1.clipes, req.body || {});
      salvar(p);
      res.json({ palavra });
    } catch (e) {
      res.status(400).json({ erro: e.message });
    }
    return undefined;
  });

  const servidor = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const porta = servidor.address().port;
  return { porta, fechar: () => new Promise((resolve) => servidor.close(resolve)) };
}

test('rota de palavras/dividir via express real, com projeto temporario', async () => {
  salvar(projetoMinimo());
  const { porta, fechar } = await subirServidorPalavras();
  try {
    const r = await fetch(`http://127.0.0.1:${porta}/api/projeto/${encodeURIComponent(NOME)}/palavras/dividir`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clipe: 'c1', indice: 0, posicao: 4 }), // "Prim" | "eira"
    });
    assert.equal(r.status, 200);
    const corpo = await r.json();
    assert.equal(corpo.palavras.length, 2);
    assert.equal(corpo.palavras[0].texto, 'Prim');
    assert.equal(corpo.palavras[1].texto, 'eira');

    const depois = carregar(NOME);
    assert.equal(depois.fase1.clipes.find((c) => c.id === 'c1').palavras.length, 5);

    const erro = await fetch(`http://127.0.0.1:${porta}/api/projeto/${encodeURIComponent(NOME)}/palavras/dividir`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clipe: 'c1', indice: 99, posicao: 1 }),
    });
    assert.equal(erro.status, 400);
  } finally {
    await fechar();
  }
});

test('rota de palavras/juntar via express real, com projeto temporario', async () => {
  salvar(projetoMinimo());
  const { porta, fechar } = await subirServidorPalavras();
  try {
    const r = await fetch(`http://127.0.0.1:${porta}/api/projeto/${encodeURIComponent(NOME)}/palavras/juntar`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clipe: 'c1', indice: 0 }), // "Primeira" + "fala"
    });
    assert.equal(r.status, 200);
    const corpo = await r.json();
    assert.equal(corpo.palavra.texto, 'Primeira fala');

    const depois = carregar(NOME);
    assert.equal(depois.fase1.clipes.find((c) => c.id === 'c1').palavras.length, 3);
  } finally {
    await fechar();
  }
});
