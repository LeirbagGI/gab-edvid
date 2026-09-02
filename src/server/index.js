import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import multer from 'multer';
import { WebSocketServer } from 'ws';
import { PORTA_PREVIEW, PROJETOS, PASTA_ENTRADA, RE_VIDEO, EXTENSOES, OLLAMA } from '../shared/config.js';
import { carregar, salvar, listar, caminhoProjeto, nomeLivre } from '../fase1/projeto.js';
import { headlinePadrao, lerBroll, lerTrilha } from '../fase2/render.js';
import { diz } from '../shared/conversa.js';
import { fila } from './fila.js';
import { interpretar } from './comandos.js';
import { conversar, temChave, cota, temCota } from './cerebro.js';
import { conversarLocal, ollamaPronto } from './local.js';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const PUBLICO = path.join(aqui, '..', '..', 'public');
const COMPARTILHADO = path.join(aqui, '..', 'shared');
const app = express();
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

// Midia dos projetos (corte, final, miniaturas, broll).
app.use('/midia', express.static(PROJETOS));

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

app.get('/api/projeto/:nome', (req, res) => {
  const p = carregar(req.params.nome);
  if (!p) return res.status(404).json({ erro: 'projeto nao encontrado' });
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

    // Ordem: Claude (se ha chave e cota) -> modelo local (de graca) -> comandos.
    const podeClaude = temChave() && temCota(atual);
    const podeLocal = !podeClaude && await ollamaPronto();

    if (podeClaude) {
      ({ projeto, trabalhos } = await conversar(req.params.nome, texto));
    } else if (podeLocal) {
      ({ projeto, trabalhos } = await conversarLocal(req.params.nome, texto));
    } else {
      // Ultimo recurso: comandos fixos. Cair para tras e melhor que travar o chat.
      const r = interpretar(req.params.nome, texto);
      projeto = r.projeto;
      if (r.trabalho) trabalhos = [r.trabalho];
      if (temChave() && !temCota(atual)) {
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
  if (temChave()) return res.json({ modo: 'claude', limite: cota({}).limite });
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
});

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
