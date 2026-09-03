import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import multer from 'multer';
import { WebSocketServer } from 'ws';
import { PORTA_PREVIEW, PROJETOS, PASTA_ENTRADA, RE_VIDEO, EXTENSOES, OLLAMA } from '../shared/config.js';
import { carregar, salvar, listar, caminhoProjeto, nomeLivre } from '../fase1/projeto.js';
import { quadroComCor } from '../fase1/render.js';
import { headlinePadrao, lerBroll, lerTrilha } from '../fase2/render.js';
import { diz } from '../shared/conversa.js';
import { LUTS, corPadrao, validarCor } from '../shared/cor.js';
import { gerarPreview } from '../shared/preview.js';
import { fila } from './fila.js';
import { interpretar } from './comandos.js';
import { conversar, temPonte, cota, temCota, MODELO } from './cerebro.js';
import { conversarLocal, ollamaPronto } from './local.js';
import { montarMcp } from './mcp.js';
import * as uploads from './upload.js';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const PUBLICO = path.join(aqui, '..', '..', 'public');
const COMPARTILHADO = path.join(aqui, '..', 'shared');
const app = express();

// O MCP precisa entrar ANTES do express.json(): o transporte streamable le
// o corpo cru da requisicao sozinho, e um express.json() anterior ja teria
// drenado o stream, deixando o corpo vazio para o SDK. `transmitir` e
// `function` hoisted — a referencia aqui resolve certo mesmo declarada
// depois no arquivo.
montarMcp(app, { carregar, salvar, transmitir, fila });

app.use(express.json({ limit: '2mb' }));

/*
 * Versao nos scripts, tirada do mtime do arquivo.
 *
 * Sem isso o navegador pode ficar com um app.js antigo em cache enquanto o
 * index.html ja e o novo — a combinacao estoura no carregamento e a pagina
 * inteira morre em silencio (a timeline para de responder, nada clica).
 */
const versao = (arquivo) => {
  try { return fs.statSync(arquivo).mtimeMs.toString(36); } catch { return '0'; }
};

app.get('/', (_req, res) => {
  const html = fs.readFileSync(path.join(PUBLICO, 'index.html'), 'utf8')
    .replace('src="app.js"', `src="app.js?v=${versao(path.join(PUBLICO, 'app.js'))}"`);
  res.type('html').send(html);
});

app.get('/app.js', (_req, res) => {
  const js = fs.readFileSync(path.join(PUBLICO, 'app.js'), 'utf8')
    .replace("'/shared/presets.js'", `'/shared/presets.js?v=${versao(path.join(COMPARTILHADO, 'presets.js'))}'`);
  res.type('js').send(js);
});

app.use(express.static(PUBLICO));

// Os presets sao compartilhados com o Remotion; o navegador le o mesmo arquivo.
app.use('/shared', express.static(COMPARTILHADO));

// Midia dos projetos (corte, final, miniaturas, broll). Cache de 7 dias: o
// cliente versiona a URL (`?v=`) quando o arquivo muda, entao servir do
// cache do navegador nao arrisca mostrar conteudo velho.
app.use('/midia', express.static(PROJETOS, { maxAge: '7d' }));

/* ------------------------------------------------------------- projetos */

app.get('/api/projetos', (_req, res) => {
  res.json(listar().map((p) => ({
    nome: p.nome,
    criadoEm: p.criadoEm,
    origem: p.origem.arquivo,
    duracao: p.fase1?.duracao,
    statusFase1: p.fase1?.status,
    statusFase2: p.fase2?.status || 'nao-iniciada',
  })));
});

/*
 * Projetos antigos (de antes do proxy de pre-visualizacao) nao tem
 * fase1.preview/fase2.preview em disco. Na primeira vez que alguem abre um
 * desses, gera em segundo plano sem segurar a resposta — o Set evita
 * disparar duas vezes se o navegador pedir o mesmo projeto de novo antes de
 * terminar (o proxy de um video de alguns minutos leva alguns segundos).
 */
const previewsEmAndamento = new Set();

function agendarPreviewsFaltantes(p) {
  const pasta = caminhoProjeto(p.nome);
  const tarefas = [];
  if (p.fase1?.arquivo && !p.fase1.preview) {
    tarefas.push({ fase: 'fase1', origem: p.fase1.arquivo, destino: 'fase1-preview.mp4' });
  }
  if (p.fase2?.status === 'pronta' && p.fase2?.arquivo && !p.fase2.preview) {
    tarefas.push({ fase: 'fase2', origem: p.fase2.arquivo, destino: 'fase2-preview.mp4' });
  }
  for (const t of tarefas) {
    const chave = `${p.nome}:${t.fase}`;
    if (previewsEmAndamento.has(chave)) continue;
    previewsEmAndamento.add(chave);
    gerarPreview(path.join(pasta, t.origem), path.join(pasta, t.destino))
      .then(() => {
        const atual = carregar(p.nome);
        if (!atual) return;
        atual[t.fase] = { ...atual[t.fase], preview: t.destino };
        salvar(atual);
        transmitir({ tipo: 'projeto', projeto: atual });
      })
      // Projeto antigo so fica sem preview — ninguem esta esperando por isso,
      // nao ha por que derrubar nada.
      .catch(() => {})
      .finally(() => previewsEmAndamento.delete(chave));
  }
}

app.get('/api/projeto/:nome', (req, res) => {
  const p = carregar(req.params.nome);
  if (!p) return res.status(404).json({ erro: 'projeto nao encontrado' });
  agendarPreviewsFaltantes(p);
  p.fase2 = {
    ...p.fase2,
    headlineSugerida: headlinePadrao(p),
    broll: lerBroll(p.nome),
    trilha: lerTrilha(p.nome),
  };
  res.json(p);
});

app.delete('/api/projeto/:nome', (req, res) => {
  const pasta = caminhoProjeto(req.params.nome);
  if (!fs.existsSync(pasta)) return res.status(404).json({ erro: 'projeto nao encontrado' });
  fs.rmSync(pasta, { recursive: true, force: true });
  transmitir({ tipo: 'lista' });
  res.json({ ok: true });
});

/* ------------------------------------------------------------- fase 1 */

app.put('/api/projeto/:nome/estilo', (req, res) => {
  const p = carregar(req.params.nome);
  if (!p) return res.status(404).json({ erro: 'projeto nao encontrado' });
  p.estilo = { ...p.estilo, ...req.body };
  salvar(p);
  transmitir({ tipo: 'projeto', projeto: p });
  res.json(p.estilo);
});

app.post('/api/projeto/:nome/fase1/:acao', (req, res) => {
  const p = carregar(req.params.nome);
  if (!p) return res.status(404).json({ erro: 'projeto nao encontrado' });
  const { acao } = req.params;
  if (!['aprovar', 'reprovar'].includes(acao)) return res.status(400).json({ erro: 'acao invalida' });
  p.fase1.status = acao === 'aprovar' ? 'aprovada' : 'ajustar';
  p.fase1.observacao = req.body?.observacao || '';
  if (acao === 'aprovar') {
    diz(p, `Corte aprovado (${(p.fase1.duracao || 0).toFixed(1).replace('.', ',')}s). `
      + 'Escolhe o estilo da Fase 2 na aba Estilo.');
  } else {
    diz(p, `Marcado para ajuste${p.fase1.observacao ? `: "${p.fase1.observacao}"` : ''}. `
      + 'Mexe na timeline e manda "refazer o corte".');
  }
  salvar(p);
  transmitir({ tipo: 'projeto', projeto: p });
  res.json({ status: p.fase1.status });
});

app.patch('/api/projeto/:nome/clipe/:id', (req, res) => {
  const p = carregar(req.params.nome);
  if (!p) return res.status(404).json({ erro: 'projeto nao encontrado' });
  const c = p.fase1.clipes.find((x) => x.id === req.params.id);
  if (!c) return res.status(404).json({ erro: 'clipe nao encontrado' });
  const { bloco, ativo, origemInicio, origemFim } = req.body;
  if (bloco) { c.bloco = bloco; c.blocoManual = true; }
  if (typeof ativo === 'boolean') c.ativo = ativo;
  if (typeof origemInicio === 'number') c.origemInicio = origemInicio;
  if (typeof origemFim === 'number') c.origemFim = origemFim;
  c.duracao = Number((c.origemFim - c.origemInicio).toFixed(3));
  p.fase1.status = 'editado';
  salvar(p);
  transmitir({ tipo: 'projeto', projeto: p });
  res.json(c);
});

/* ------------------------------------------------------------- cor (F1) */

app.get('/api/luts', (_req, res) => res.json(LUTS));

app.put('/api/projeto/:nome/cor', (req, res) => {
  const p = carregar(req.params.nome);
  if (!p) return res.status(404).json({ erro: 'projeto nao encontrado' });

  const corpo = req.body || {};
  const patch = {};
  if (Object.prototype.hasOwnProperty.call(corpo, 'lut')) patch.lut = corpo.lut;
  if (Object.prototype.hasOwnProperty.call(corpo, 'intensidade')) patch.intensidade = corpo.intensidade;
  if (corpo.ajustes) patch.ajustes = corpo.ajustes;

  const { ok, erros } = validarCor(patch);
  if (!ok) return res.status(400).json({ erro: erros.join('; ') });

  const atual = p.cor || corPadrao();
  p.cor = {
    lut: Object.prototype.hasOwnProperty.call(patch, 'lut') ? patch.lut : atual.lut,
    intensidade: Object.prototype.hasOwnProperty.call(patch, 'intensidade') ? patch.intensidade : atual.intensidade,
    ajustes: { ...atual.ajustes, ...(patch.ajustes || {}) },
  };
  salvar(p);
  transmitir({ tipo: 'projeto', projeto: p });
  // Nao re-renderiza sozinho: o corte em disco so muda quando o cliente
  // manda POST /api/fila/refazer (ou a ferramenta de chat equivalente).
  res.json({ cor: p.cor, precisaRefazer: true });
});

// Um quadro do video de ORIGEM (nao do corte) com a cor aplicada, para o
// antes/depois na aba Cor (F2). Cache em disco por hash da cor+tempo.
app.get('/api/projeto/:nome/cor/preview', async (req, res) => {
  try {
    const p = carregar(req.params.nome);
    if (!p) return res.status(404).json({ erro: 'projeto nao encontrado' });
    if (!p.origem?.caminho) return res.status(400).json({ erro: 'projeto sem video de origem' });

    const ativos = (p.fase1?.clipes || []).filter((c) => c.ativo !== false);
    const primeiro = ativos[0];
    const tempoDefault = primeiro
      ? (primeiro.origemInicio + primeiro.origemFim) / 2
      : (p.origem.duracao || 1) / 2;
    const t = req.query.t !== undefined ? Number(req.query.t) : tempoDefault;
    if (!Number.isFinite(t) || t < 0) return res.status(400).json({ erro: 't invalido' });

    const aplicar = req.query.aplicar !== '0';
    const cor = aplicar ? (p.cor || corPadrao()) : corPadrao();

    const chave = crypto.createHash('sha1')
      .update(JSON.stringify({ cor, t: Number(t.toFixed(2)) }))
      .digest('hex')
      .slice(0, 16);
    const pastaTrabalho = path.join(caminhoProjeto(p.nome), 'trabalho');
    fs.mkdirSync(pastaTrabalho, { recursive: true });
    const destino = path.join(pastaTrabalho, `preview-cor-${chave}.jpg`);

    if (!fs.existsSync(destino)) {
      await quadroComCor(p.origem.caminho, t, cor, destino);
    }
    res.type('jpg').sendFile(destino);
  } catch (e) {
    res.status(400).json({ erro: e.message });
  }
});

/* ------------------------------------------------------------- fase 2 */

app.put('/api/projeto/:nome/fase2', (req, res) => {
  const p = carregar(req.params.nome);
  if (!p) return res.status(404).json({ erro: 'projeto nao encontrado' });
  const { headline, volumeTrilha } = req.body;
  p.fase2 = { ...p.fase2 };
  if (typeof headline === 'string') p.fase2.headline = headline;
  if (typeof volumeTrilha === 'number') p.fase2.volumeTrilha = volumeTrilha;
  salvar(p);
  transmitir({ tipo: 'projeto', projeto: p });
  res.json(p.fase2);
});

/* ------------------------------------------------------------- chat */

// O chat lateral: interpreta o comando, mexe no projeto e devolve a conversa.
app.post('/api/projeto/:nome/conversa', async (req, res) => {
  const texto = String(req.body?.texto || '').trim();
  if (!texto) return res.status(400).json({ erro: 'texto vazio' });
  try {
    let projeto;
    let trabalhos = [];
    const atual = carregar(req.params.nome);
    if (!atual) return res.status(404).json({ erro: 'projeto nao encontrado' });

    // Ordem: Claude (se a ponte esta de pe e ha cota) -> modelo local (de graca) -> comandos.
    const podePonte = await temPonte();
    const podeClaude = podePonte && temCota(atual);
    const podeLocal = !podeClaude && await ollamaPronto();

    if (podeClaude) {
      const nome = req.params.nome;
      ({ projeto, trabalhos } = await conversar(nome, texto, {
        aoParcial: (parcial) => transmitir({ tipo: 'chat-parcial', nome, texto: parcial }),
      }));
    } else if (podeLocal) {
      ({ projeto, trabalhos } = await conversarLocal(req.params.nome, texto));
    } else {
      // Ultimo recurso: comandos fixos. Cair para tras e melhor que travar o chat.
      const r = interpretar(req.params.nome, texto);
      projeto = r.projeto;
      if (r.trabalho) trabalhos = [r.trabalho];
      if (podePonte && !temCota(atual)) {
        diz(projeto, `A conversa livre deste projeto acabou (${cota(atual).limite} mensagens). `
          + 'Respondi pelos comandos fixos. Para liberar mais, clique no contador no rodapé do chat.');
        salvar(projeto);
      }
    }
    trabalhos.forEach((t) => fila.enfileirar(t.tipo, { nome: t.nome }));
    transmitir({ tipo: 'projeto', projeto });
    res.json({ conversa: projeto.conversa, estilo: projeto.estilo, fase1: projeto.fase1 });
  } catch (e) {
    res.status(400).json({ erro: e.message });
  }
});

// Zera a cota de conversa de um projeto.
app.post('/api/projeto/:nome/chat/zerar', (req, res) => {
  const p = carregar(req.params.nome);
  if (!p) return res.status(404).json({ erro: 'projeto nao encontrado' });
  p.chat = { ...p.chat, usadas: 0 };
  salvar(p);
  transmitir({ tipo: 'projeto', projeto: p });
  res.json(cota(p));
});

// O rodape do chat diz em que modo ele esta.
app.get('/api/chat/modo', async (_req, res) => {
  if (await temPonte()) {
    const { limite, restam } = cota({});
    return res.json({ modo: 'claude', modelo: MODELO, limite, restam });
  }
  if (await ollamaPronto()) return res.json({ modo: 'local', modelo: OLLAMA.modelo });
  res.json({ modo: 'comandos' });
});

/* ------------------------------------------------------------- fila */

app.get('/api/fila', (_req, res) => res.json(fila.estado()));

app.post('/api/fila/:tipo', (req, res) => {
  const { tipo } = req.params;
  if (!['fase1', 'fase2', 'refazer'].includes(tipo)) {
    return res.status(400).json({ erro: 'tipo invalido' });
  }
  const item = fila.enfileirar(tipo, req.body);
  res.json(item);
});

app.delete('/api/fila/:id', (req, res) => res.json({ ok: fila.cancelar(req.params.id) }));

/* ------------------------------------------------------- upload em pedacos */

/*
 * O Traefik da VPS corta requisicao parada em 60s (readTimeout padrao); um
 * POST /api/upload de video grande passa disso facil e vira 502 no
 * navegador. Aqui cada pedaco e uma requisicao curta — a sessao fica em
 * PASTA_ENTRADA/.parciais/<id>/ (src/server/upload.js) ate finalizar montar
 * o arquivo inteiro e enfileirar a Fase 1, exatamente como o /api/upload
 * antigo (que continua existindo, para arquivo pequeno e para a CLI).
 */

app.post('/api/upload/iniciar', (req, res) => {
  try {
    const { nome, tamanho, tipo } = req.body || {};
    if (!nome || !RE_VIDEO.test(nome)) {
      return res.status(400).json({ erro: `extensao nao aceita. Use: ${EXTENSOES.join(', ')}` });
    }
    res.json(uploads.iniciar({ nome, tamanho, tipo }));
  } catch (e) {
    res.status(400).json({ erro: e.message });
  }
});

// Corpo binario cru — so nesta rota. `express.json()` la em cima nao mexe
// aqui porque so parseia quando o content-type e application/json.
app.put('/api/upload/:id/:indice', express.raw({ type: '*/*', limit: '16mb' }), (req, res) => {
  try {
    res.json(uploads.receberPedaco(req.params.id, req.params.indice, req.body));
  } catch (e) {
    res.status(400).json({ erro: e.message });
  }
});

app.get('/api/upload/:id', (req, res) => {
  try {
    res.json(uploads.estado(req.params.id));
  } catch (e) {
    res.status(404).json({ erro: e.message });
  }
});

app.post('/api/upload/:id/finalizar', (req, res) => {
  try {
    const { caminho } = uploads.finalizar(req.params.id);
    const nome = nomeLivre(path.basename(caminho));
    const item = fila.enfileirar('fase1', { arquivo: caminho, nome });
    transmitir({ tipo: 'lista' });
    res.json({ item, nome });
  } catch (e) {
    res.status(400).json({ erro: e.message });
  }
});

/* ------------------------------------------------------------- upload */

fs.mkdirSync(PASTA_ENTRADA, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: (_r, _f, cb) => cb(null, PASTA_ENTRADA),
    filename: (_r, file, cb) => {
      // Nome original, mas sem sobrescrever o que ja esta la.
      const base = path.basename(file.originalname);
      let nome = base;
      let i = 2;
      while (fs.existsSync(path.join(PASTA_ENTRADA, nome))) {
        const ext = path.extname(base);
        nome = `${path.basename(base, ext)} ${i++}${ext}`;
      }
      cb(null, nome);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = RE_VIDEO.test(file.originalname);
    if (!ok) (req.recusados = req.recusados || []).push(file.originalname);
    cb(null, ok);
  },
});

// Sobe um ou varios videos e ja enfileira a Fase 1 de cada um.
app.post('/api/upload', upload.array('videos', 30), (req, res) => {
  const enfileirados = (req.files || []).map((f) => {
    const nome = nomeLivre(f.filename);
    return fila.enfileirar('fase1', { arquivo: f.path, nome });
  });
  transmitir({ tipo: 'lista' });
  // `recusados` existe para o navegador poder dizer POR QUE nada aconteceu.
  res.json({
    enfileirados: enfileirados.length,
    itens: enfileirados,
    recusados: req.recusados || [],
    aceitos: EXTENSOES,
  });
});

// Imagens de b-roll e trilha ficam dentro da pasta do projeto, que e o
// publicDir do Remotion no render — por isso vao direto para la.
const arquivoDoProjeto = (sub) => multer({
  storage: multer.diskStorage({
    destination: (req, _f, cb) => {
      const destino = sub ? path.join(caminhoProjeto(req.params.nome), sub)
        : caminhoProjeto(req.params.nome);
      fs.mkdirSync(destino, { recursive: true });
      cb(null, destino);
    },
    filename: (_r, file, cb) => cb(null, path.basename(file.originalname)),
  }),
  limits: { fileSize: 200 * 1024 * 1024 },
});

app.post('/api/projeto/:nome/broll', arquivoDoProjeto('broll').array('imagens', 20), (req, res) => {
  transmitir({ tipo: 'projeto', projeto: carregar(req.params.nome) });
  res.json({ enviadas: (req.files || []).length, broll: lerBroll(req.params.nome) });
});

app.post('/api/projeto/:nome/trilha', arquivoDoProjeto(null).single('audio'), (req, res) => {
  if (!req.file) return res.status(400).json({ erro: 'nenhum arquivo' });
  // O render procura por "trilha.<ext>"; renomeia para o nome esperado.
  const pasta = caminhoProjeto(req.params.nome);
  const ext = (path.extname(req.file.originalname) || '.mp3').toLowerCase();
  const destino = path.join(pasta, `trilha${ext === '.mp3' || ext === '.m4a' || ext === '.wav' ? ext : '.mp3'}`);
  fs.renameSync(req.file.path, destino);
  res.json({ trilha: path.basename(destino) });
});

app.delete('/api/projeto/:nome/trilha', (req, res) => {
  const t = lerTrilha(req.params.nome);
  if (t) fs.rmSync(path.join(caminhoProjeto(req.params.nome), t), { force: true });
  res.json({ ok: true });
});

// Enfileira a Fase 1 de tudo que ja esta na pasta de entrada e ainda nao virou projeto.
app.post('/api/varrer', (_req, res) => {
  const jaFeitos = new Set(listar().map((p) => p.origem.caminho));
  const novos = fs.readdirSync(PASTA_ENTRADA)
    .filter((f) => RE_VIDEO.test(f) && !f.startsWith('.'))
    .map((f) => path.join(PASTA_ENTRADA, f))
    .filter((p) => !jaFeitos.has(p));
  novos.forEach((arquivo) => fila.enfileirar('fase1', { arquivo, nome: nomeLivre(path.basename(arquivo)) }));
  res.json({ enfileirados: novos.length });
});

/* ------------------------------------------------------------- ws */

const servidor = app.listen(PORTA_PREVIEW, () => {
  console.log(`\n  Edvid — preview em http://localhost:${PORTA_PREVIEW}/\n`);
  // Fila persistente (A1): retoma o que ficou pendente de uma queda do servidor.
  if (typeof fila.retomar === 'function') fila.retomar();
  // Sessao de upload em pedacos abandonada (aba fechada no meio) some sozinha.
  uploads.limparVelhos(24);
});

// Sem isto o proprio Node corta a conexao antes do pedaco de upload (ou de
// qualquer requisicao mais longa) terminar — o timeout do Traefik (60s) e o
// motivo de existir o upload em pedacos; o do Node nao pode ser outro corte
// pela mesma razao. `headersTimeout`/`keepAliveTimeout` seguem a folga
// recomendada pelo proprio Node (> qualquer timeout de proxy na frente).
servidor.requestTimeout = 0;
servidor.headersTimeout = 65000;
servidor.keepAliveTimeout = 65000;

// Sem isto, porta ocupada vira um stack trace do Node e parece que o app quebrou.
servidor.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\n  A porta ${PORTA_PREVIEW} já está em uso — provavelmente o preview`);
    console.error('  já está rodando em outra aba do terminal.\n');
    console.error('  Se quiser derrubar o que está lá e subir de novo:');
    console.error(`    lsof -ti:${PORTA_PREVIEW} | xargs kill -9 && npm run preview\n`);
  } else {
    console.error(`\n  Não consegui subir o preview: ${e.message}\n`);
  }
  process.exit(1);
});

const wss = new WebSocketServer({ server: servidor, path: '/ws' });
const clientes = new Set();
wss.on('connection', (ws) => {
  clientes.add(ws);
  ws.send(JSON.stringify({ tipo: 'fila', estado: fila.estado() }));
  ws.on('close', () => clientes.delete(ws));
});

export function transmitir(msg) {
  const txt = JSON.stringify(msg);
  for (const c of clientes) if (c.readyState === 1) c.send(txt);
}

fila.on('mudou', (estado) => transmitir({ tipo: 'fila', estado }));
fila.on('progresso', (item) => transmitir({ tipo: 'progresso', item }));

// Canal para a CLI empurrar progresso quando roda fora do servidor.
app.post('/api/log', (req, res) => {
  transmitir({ tipo: 'log', ...req.body });
  res.json({ ok: true });
});

// Estado em disco mudou (CLI, edicao manual do json) — avisa o navegador.
fs.mkdirSync(PROJETOS, { recursive: true });
const { default: chokidar } = await import('chokidar');
chokidar.watch(path.join(PROJETOS, '*', 'projeto.json'), { ignoreInitial: true })
  .on('change', (arq) => {
    const p = carregar(path.basename(path.dirname(arq)));
    if (p) transmitir({ tipo: 'projeto', projeto: p });
  })
  .on('add', () => transmitir({ tipo: 'lista' }));
