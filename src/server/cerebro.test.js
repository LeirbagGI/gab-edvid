import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * O cerebro fala com a ponte-claude por HTTP puro (fetch + SSE), sem SDK
 * nenhum no meio. Aqui uma ponte de mentira responde /saude e /conversar
 * com um stream fixo, e o teste confere o contrato: texto parcial chega em
 * tempo real, a sessao e a cota gravam certo, e a trava de afirmacao falsa
 * (`conferir`) continua funcionando quando nenhuma ferramenta MCP rodou.
 *
 * `PONTE_URL` e `EDVID_RAIZ` precisam estar no ambiente ANTES de config.js
 * ser avaliado — por isso os imports de cerebro.js e fase1/projeto.js sao
 * dinamicos, depois de setar as env (mesmo truque de fila.test.js).
 */

function iniciarPonteFalsa() {
  const servidor = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/saude') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, claude: '2.1.259 (Claude Code)' }));
      return;
    }
    if (req.method === 'POST' && req.url === '/conversar') {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const evento = (dado, nome) => {
        if (nome) res.write(`event: ${nome}\n`);
        res.write(`data: ${JSON.stringify(dado)}\n\n`);
      };
      evento({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Mu' } } });
      evento({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'dei' } } });
      evento({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: ' a cor.' } } });
      evento({
        type: 'result',
        result: 'Mudei a cor.',
        session_id: 'abc',
        usage: { input_tokens: 500, cache_read_input_tokens: 100, output_tokens: 30 },
        total_cost_usd: 0.0021,
        is_error: false,
        num_turns: 1,
      });
      evento({ rc: 0, stderr: '' }, 'fim');
      res.end();
      return;
    }
    res.writeHead(404);
    res.end();
  });
  return new Promise((resolve) => servidor.listen(0, () => resolve(servidor)));
}

const NOME = 'projeto-teste';

function projetoMinimo() {
  return {
    nome: NOME,
    origem: { arquivo: 'bruto.mov', duracao: 30 },
    fase1: {
      status: 'pronta',
      duracao: 12.3,
      clipes: [{ id: 'c1', texto: 'Primeira fala', bloco: 'HOOK', ativo: true }],
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

test('conversa pela ponte: parciais, sessao, cota e a trava de afirmacao falsa', async () => {
  const servidorFalso = await iniciarPonteFalsa();
  const porta = servidorFalso.address().port;

  process.env.PONTE_URL = `http://127.0.0.1:${porta}`;
  process.env.EDVID_RAIZ = fs.mkdtempSync(path.join(os.tmpdir(), 'edvid-cerebro-'));

  const { salvar } = await import('../fase1/projeto.js');
  const { conversar, temPonte } = await import('./cerebro.js');

  salvar(projetoMinimo());

  assert.equal(await temPonte(), true, 'a ponte de mentira deveria responder /saude');

  const parciais = [];
  const { projeto } = await conversar(NOME, 'muda a cor pra azul', {
    aoParcial: (texto) => parciais.push(texto),
    urlMcp: 'http://127.0.0.1:1/mcp/nao-usado', // nada chama MCP nesta ponte de mentira
  });

  assert.equal(parciais.length, 3, 'deveria ter chamado aoParcial uma vez por text_delta');
  assert.deepEqual(parciais, ['Mu', 'Mudei', 'Mudei a cor.']);

  assert.equal(projeto.chat.sessao, 'abc');
  assert.equal(projeto.chat.usadas, 1);

  // Nenhuma ferramenta MCP rodou (a ponte de mentira nao chama nada de
  // volta) — o texto "Mudei a cor." afirma acao sem registro, e a trava
  // (`conferir`) tem que acusar isso na ultima mensagem do chat.
  const ultima = projeto.conversa.at(-1);
  assert.match(ultima.texto, /⚠ Na verdade não mudei nada/);

  await new Promise((resolve) => servidorFalso.close(resolve));
});
