import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * O cerebro fala com a ponte-claude por HTTP puro (fetch + SSE), sem SDK
 * nenhum no meio. Aqui uma ponte de mentira responde /saude e /conversar
 * com um stream fixo, e os testes conferem o contrato: texto parcial chega em
 * tempo real, a sessao e a cota gravam certo, a trava de afirmacao falsa
 * (`conferir`) continua funcionando quando nenhuma ferramenta MCP rodou, e o
 * Magnific só entra no corpo da chamada quando o pedido pede geração por IA.
 *
 * `PONTE_URL` e `EDVID_RAIZ` precisam estar no ambiente ANTES de config.js
 * ser avaliado — por isso os imports de cerebro.js e fase1/projeto.js sao
 * dinamicos, depois de setar as env (mesmo truque de fila.test.js). Como o
 * import de um mesmo caminho e cacheado pelo Node, a ponte de mentira e a
 * env sao montadas uma unica vez no topo do arquivo e reaproveitadas pelos
 * testes — cada teste reseta o projeto salvando `projetoMinimo()` de novo.
 */

function iniciarPonteFalsa() {
  const servidor = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/saude') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, claude: '2.1.259 (Claude Code)' }));
      return;
    }
    if (req.method === 'POST' && req.url === '/conversar') {
      let corpo = '';
      req.on('data', (c) => { corpo += c; });
      req.on('end', () => {
        try {
          servidor.ultimoCorpo = JSON.parse(corpo);
        } catch {
          servidor.ultimoCorpo = null;
        }
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
      });
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

const servidorFalso = await iniciarPonteFalsa();
const porta = servidorFalso.address().port;

process.env.PONTE_URL = `http://127.0.0.1:${porta}`;
process.env.EDVID_RAIZ = fs.mkdtempSync(path.join(os.tmpdir(), 'edvid-cerebro-'));

const { salvar, caminhoProjeto } = await import('../fase1/projeto.js');
const { conversar, temPonte, precisaMagnific } = await import('./cerebro.js');
const { executar } = await import('./ferramentas.js');

after(() => new Promise((resolve) => servidorFalso.close(resolve)));

test('conversa pela ponte: parciais, sessao, cota e a trava de afirmacao falsa', async () => {
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

  // "muda a cor pra azul" nao pede geração por IA — nao deveria acionar o Magnific.
  assert.equal(servidorFalso.ultimoCorpo.mcp.magnific, undefined);
});

test('pedido de geração por IA aciona o Magnific na chamada à ponte', async () => {
  salvar(projetoMinimo());

  assert.equal(precisaMagnific('gera uma intro com ia'), true);

  await conversar(NOME, 'gera uma intro com ia', {
    urlMcp: 'http://127.0.0.1:1/mcp/nao-usado',
  });

  const corpo = servidorFalso.ultimoCorpo;
  assert.ok(corpo.mcp.magnific, 'deveria mandar o mcp do magnific junto com o do edvid');
  assert.equal(corpo.mcp.magnific.url, 'https://mcp.magnific.com');
  assert.ok(corpo.mcp.edvid, 'o mcp do edvid continua indo junto');
  assert.ok(
    corpo.ferramentas_permitidas.includes('mcp__magnific__images_generate'),
    'ferramentas_permitidas deveria incluir as ferramentas do magnific',
  );
  assert.ok(corpo.ferramentas_permitidas.includes('mcp__edvid__*'));
  assert.equal(corpo.timeout_s, 600);
  assert.equal(corpo.max_voltas, 12);
  assert.equal(corpo.esforco, 'medium');
  assert.match(corpo.sistema, /Geração por IA \(Magnific\)/);
});

test('pedido comum ("aprova o corte") não aciona o Magnific', async () => {
  salvar(projetoMinimo());

  assert.equal(precisaMagnific('aprova o corte'), false);

  await conversar(NOME, 'aprova o corte', {
    urlMcp: 'http://127.0.0.1:1/mcp/nao-usado',
  });

  const corpo = servidorFalso.ultimoCorpo;
  assert.equal(corpo.mcp.magnific, undefined);
  assert.ok(!corpo.ferramentas_permitidas.includes('mcp__magnific__images_generate'));
  assert.equal(corpo.timeout_s, 180);
  assert.equal(corpo.max_voltas, 6);
  assert.doesNotMatch(corpo.sistema, /Geração por IA \(Magnific\)/);
});

test('baixar_para_projeto baixa um arquivo de verdade e salva na pasta do projeto', async () => {
  const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const pngBuffer = Buffer.from(pngBase64, 'base64');

  const servidorArquivo = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'image/png', 'content-length': String(pngBuffer.length) });
    res.end(pngBuffer);
  });
  await new Promise((resolve) => servidorArquivo.listen(0, resolve));
  const portaArquivo = servidorArquivo.address().port;

  const projeto = projetoMinimo();
  const trabalhos = [];
  const registro = [];
  const resultado = await executar('baixar_para_projeto', {
    url: `http://127.0.0.1:${portaArquivo}/imagem.png`,
    tipo: 'broll',
    nome: 'gerado-teste',
  }, projeto, trabalhos, registro);

  assert.match(resultado, /Baixei broll para broll[/\\]gerado-teste\.png \(\d+ KB\)/);
  assert.equal(registro.length, 1);
  assert.equal(registro[0].ferramenta, 'baixar_para_projeto');
  assert.equal(registro[0].resultado, resultado, 'o registro tem que guardar o texto resolvido, nao a Promise');

  const destino = path.join(caminhoProjeto(projeto.nome), 'broll', 'gerado-teste.png');
  assert.ok(fs.existsSync(destino));
  assert.deepEqual(fs.readFileSync(destino), pngBuffer);

  await new Promise((resolve) => servidorArquivo.close(resolve));
});
