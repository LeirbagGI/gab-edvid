import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import multer from 'multer';
import { WebSocketServer } from 'ws';
import { PORTA_PREVIEW, PROJETOS, PASTA_ENTRADA, RE_VIDEO, EXTENSOES, OLLAMA, SAIDA } from '../shared/config.js';
import { carregar, salvar, listar, caminhoProjeto, nomeLivre } from '../fase1/projeto.js';
import { quadroComCor } from '../fase1/render.js';
import { headlinePadrao, lerBroll, lerTrilha } from '../fase2/render.js';
import { diz } from '../shared/conversa.js';
import { LUTS, corPadrao, validarCor } from '../shared/cor.js';
import { gerarPreview } from '../shared/preview.js';
import { TRANSICOES, ANIMACOES_INTRO, INTRO_PADRAO, acharTransicao } from '../shared/efeitos.js';
import { gerarSrt, gerarAss } from '../shared/legenda-export.js';
import {
  editarPalavra, dividirPalavra, juntarPalavra, empurrarPalavra, validarConfigLegenda,
} from './legenda-edicao.js';
import { ffprobe } from '../shared/exec.js';
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

/* ---------------------------------------------- validacao (transicao/efeitos) */

/** `{ tipo, duracao? } | null` — usado tanto em `estilo.transicao` quanto por clipe. */
function validarTransicaoPatch(t) {
  if (t === null || t === undefined) return [];
  if (typeof t !== 'object' || Array.isArray(t)) return ['transicao precisa ser um objeto ou null'];
  const erros = [];
  if (!t.tipo || !TRANSICOES.some((x) => x.id === t.tipo)) erros.push(`transicao.tipo invalida: "${t.tipo}"`);
  if (t.duracao !== undefined && (typeof t.duracao !== 'number' || t.duracao < 0)) {
    erros.push('transicao.duracao precisa ser numero >= 0');
  }
  return erros;
}

/** `estilo.efeitos` do projeto: grao/vinheta/shake 0..1, blurFundo/letterbox booleanos, barraProgresso. */
function validarEfeitosProjetoPatch(e) {
  if (e === null || e === undefined) return [];
  if (typeof e !== 'object' || Array.isArray(e)) return ['efeitos precisa ser um objeto ou null'];
  const erros = [];
  for (const chave of ['grao', 'vinheta', 'shake']) {
    if (e[chave] !== undefined && (typeof e[chave] !== 'number' || e[chave] < 0 || e[chave] > 1)) {
      erros.push(`efeitos.${chave} precisa estar entre 0 e 1`);
    }
  }
  if (e.blurFundo !== undefined && typeof e.blurFundo !== 'boolean') erros.push('efeitos.blurFundo precisa ser booleano');
  if (e.letterbox !== undefined && typeof e.letterbox !== 'boolean') erros.push('efeitos.letterbox precisa ser booleano');
  if (Object.prototype.hasOwnProperty.call(e, 'barraProgresso') && e.barraProgresso !== null) {
    if (typeof e.barraProgresso !== 'object' || !['topo', 'base'].includes(e.barraProgresso.posicao)) {
      erros.push('efeitos.barraProgresso precisa ser { posicao: "topo"|"base" } ou null');
    }
  }
  return erros;
}

/** `fase1.clipes[].efeitos`: mesmo grao/vinheta/shake, mais `congelar` (segundos, 0..5). */
function validarEfeitosClipePatch(e) {
  if (e === null || e === undefined) return [];
  if (typeof e !== 'object' || Array.isArray(e)) return ['efeitos precisa ser um objeto ou null'];
  const erros = [];
  for (const chave of ['grao', 'vinheta', 'shake']) {
    if (e[chave] !== undefined && (typeof e[chave] !== 'number' || e[chave] < 0 || e[chave] > 1)) {
      erros.push(`efeitos.${chave} precisa estar entre 0 e 1`);
    }
  }
  if (e.congelar !== undefined && (typeof e.congelar !== 'number' || e.congelar < 0 || e.congelar > 5)) {
    erros.push('efeitos.congelar precisa estar entre 0 e 5');
  }
  return erros;
}

/* ------------------------------------------------------------- fase 1 */

app.put('/api/projeto/:nome/estilo', (req, res) => {
  const p = carregar(req.params.nome);
  if (!p) return res.status(404).json({ erro: 'projeto nao encontrado' });

  const corpo = req.body || {};
  const temTransicao = Object.prototype.hasOwnProperty.call(corpo, 'transicao');
  const temEfeitos = Object.prototype.hasOwnProperty.call(corpo, 'efeitos');
  const erros = [
    ...(temTransicao ? validarTransicaoPatch(corpo.transicao) : []),
    ...(temEfeitos ? validarEfeitosProjetoPatch(corpo.efeitos) : []),
  ];
  if (erros.length) return res.status(400).json({ erro: erros.join('; ') });

  // Campos simples (tipoEdicao, corDestaque, estiloHeadline, estiloLegenda,
  // observacoes...) entram por merge raso, como sempre; elementos/efeitos/
  // transicao mesclam campo a campo, sem apagar o que nao veio no pedido.
  const { transicao, efeitos, elementos, ...simples } = corpo;
  p.estilo = { ...p.estilo, ...simples };
  if (elementos) p.estilo.elementos = { ...(p.estilo.elementos || {}), ...elementos };
  if (temEfeitos) {
    if (efeitos === null) delete p.estilo.efeitos;
    else p.estilo.efeitos = { ...(p.estilo.efeitos || {}), ...efeitos };
  }
  if (temTransicao) {
    if (transicao === null) delete p.estilo.transicao;
    else p.estilo.transicao = { ...(p.estilo.transicao || {}), ...transicao };
  }

  // Coerencia entre elementos.flashNaTransicao e transicao.tipo === 'flash', nos dois sentidos.
  if (transicao?.tipo) {
    p.estilo.elementos = { ...(p.estilo.elementos || {}), flashNaTransicao: transicao.tipo === 'flash' };
  } else if (elementos && Object.prototype.hasOwnProperty.call(elementos, 'flashNaTransicao')) {
    if (elementos.flashNaTransicao) {
      p.estilo.transicao = {
        ...(p.estilo.transicao || {}), tipo: 'flash', duracao: p.estilo.transicao?.duracao ?? acharTransicao('flash').duracao,
      };
    } else if (p.estilo.transicao?.tipo === 'flash') {
      p.estilo.transicao = { tipo: 'corte', duracao: acharTransicao('corte').duracao };
    }
  }

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

  const {
    bloco, ativo, origemInicio, origemFim, transicao, efeitos,
  } = req.body;
  const temTransicao = Object.prototype.hasOwnProperty.call(req.body, 'transicao');
  const temEfeitos = Object.prototype.hasOwnProperty.call(req.body, 'efeitos');
  const erros = [
    ...(temTransicao ? validarTransicaoPatch(transicao) : []),
    ...(temEfeitos ? validarEfeitosClipePatch(efeitos) : []),
  ];
  if (erros.length) return res.status(400).json({ erro: erros.join('; ') });

  if (bloco) { c.bloco = bloco; c.blocoManual = true; }
  if (typeof ativo === 'boolean') c.ativo = ativo;
  if (typeof origemInicio === 'number') c.origemInicio = origemInicio;
  if (typeof origemFim === 'number') c.origemFim = origemFim;
  c.duracao = Number((c.origemFim - c.origemInicio).toFixed(3));

  if (temTransicao) {
    if (transicao === null) delete c.transicao;
    else c.transicao = { tipo: transicao.tipo, ...(transicao.duracao !== undefined ? { duracao: transicao.duracao } : {}) };
  }
  if (temEfeitos) {
    if (efeitos === null) delete c.efeitos;
    else c.efeitos = { ...(c.efeitos || {}), ...efeitos };
  }

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

/* ------------------------------------------------------------- intro (Epico E) */

const RE_INTRO = /\.(png|jpe?g|webp|mp4|mov|webm|m4v)$/i;
const EXT_VIDEO_INTRO = new Set(['mp4', 'mov', 'webm', 'm4v']);

const uploadIntro = multer({
  storage: multer.diskStorage({
    destination: (req, _f, cb) => {
      const destino = path.join(caminhoProjeto(req.params.nome), 'intro');
      fs.mkdirSync(destino, { recursive: true });
      cb(null, destino);
    },
    filename: (_r, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const base = path.basename(file.originalname, ext)
        .replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'capa';
      cb(null, `${base}${ext}`);
    },
  }),
  limits: { fileSize: 300 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, RE_INTRO.test(file.originalname)),
});

app.post('/api/projeto/:nome/intro', uploadIntro.single('arquivo'), async (req, res) => {
  try {
    const p = carregar(req.params.nome);
    if (!p) return res.status(404).json({ erro: 'projeto nao encontrado' });
    if (!req.file) return res.status(400).json({ erro: 'nenhum arquivo (campo "arquivo", imagem ou video)' });

    const pasta = caminhoProjeto(p.nome);
    const ext = path.extname(req.file.path).replace('.', '').toLowerCase();
    const ehVideo = EXT_VIDEO_INTRO.has(ext);

    let duracao = INTRO_PADRAO.duracao;
    if (ehVideo) {
      const info = await ffprobe(req.file.path);
      duracao = info.duracao;
    } else if (req.body.duracao !== undefined && Number.isFinite(Number(req.body.duracao)) && Number(req.body.duracao) > 0) {
      duracao = Number(req.body.duracao);
    }

    p.intro = {
      arquivo: path.relative(pasta, req.file.path),
      tipo: ehVideo ? 'video' : 'imagem',
      duracao: Number(duracao.toFixed(3)),
    };
    if (!ehVideo) {
      p.intro.animacao = ANIMACOES_INTRO.includes(req.body.animacao) ? req.body.animacao : INTRO_PADRAO.animacao;
    }
    if (req.body.headline !== undefined) p.intro.headline = req.body.headline === 'true' || req.body.headline === true;

    salvar(p);
    transmitir({ tipo: 'projeto', projeto: p });
    res.json(p.intro);
  } catch (e) {
    res.status(400).json({ erro: e.message });
  }
});

app.put('/api/projeto/:nome/intro', (req, res) => {
  const p = carregar(req.params.nome);
  if (!p) return res.status(404).json({ erro: 'projeto nao encontrado' });
  if (!p.intro) return res.status(400).json({ erro: 'projeto sem intro' });

  const { duracao, animacao, headline } = req.body || {};
  if (typeof duracao === 'number') p.intro.duracao = duracao;
  if (animacao !== undefined) {
    if (!ANIMACOES_INTRO.includes(animacao)) return res.status(400).json({ erro: `animacao invalida: "${animacao}"` });
    p.intro.animacao = animacao;
  }
  if (typeof headline === 'boolean') p.intro.headline = headline;

  salvar(p);
  transmitir({ tipo: 'projeto', projeto: p });
  res.json(p.intro);
});

app.delete('/api/projeto/:nome/intro', (req, res) => {
  const p = carregar(req.params.nome);
  if (!p) return res.status(404).json({ erro: 'projeto nao encontrado' });
  if (p.intro?.arquivo) fs.rmSync(path.join(caminhoProjeto(p.nome), p.intro.arquivo), { force: true });
  delete p.intro;
  salvar(p);
  transmitir({ tipo: 'projeto', projeto: p });
  res.json({ ok: true });
});

/* ------------------------------------------------------------- legenda (Epico D) */

app.put('/api/projeto/:nome/legenda', (req, res) => {
  const p = carregar(req.params.nome);
  if (!p) return res.status(404).json({ erro: 'projeto nao encontrado' });

  const corpo = req.body || {};
  const erros = validarConfigLegenda(corpo);
  if (erros.length) return res.status(400).json({ erro: erros.join('; ') });

  p.estilo = p.estilo || {};
  p.estilo.legenda = { ...(p.estilo.legenda || {}) };
  for (const [k, v] of Object.entries(corpo)) {
    if (v === null) delete p.estilo.legenda[k]; else p.estilo.legenda[k] = v;
  }
  salvar(p);
  transmitir({ tipo: 'projeto', projeto: p });
  res.json(p.estilo.legenda);
});

// Edicao de legenda: mexe direto em fase1.clipes[].palavras (logica pura em
// legenda-edicao.js) — cada rota carrega, chama, salva e transmite.
app.patch('/api/projeto/:nome/palavras', (req, res) => {
  const p = carregar(req.params.nome);
  if (!p) return res.status(404).json({ erro: 'projeto nao encontrado' });
  try {
    const palavra = editarPalavra(p.fase1?.clipes || [], req.body || {});
    salvar(p);
    transmitir({ tipo: 'projeto', projeto: p });
    res.json({ palavra });
  } catch (e) {
    res.status(400).json({ erro: e.message });
  }
});

app.post('/api/projeto/:nome/palavras/dividir', (req, res) => {
  const p = carregar(req.params.nome);
  if (!p) return res.status(404).json({ erro: 'projeto nao encontrado' });
  try {
    const palavras = dividirPalavra(p.fase1?.clipes || [], req.body || {});
    salvar(p);
    transmitir({ tipo: 'projeto', projeto: p });
    res.json({ palavras });
  } catch (e) {
    res.status(400).json({ erro: e.message });
  }
});

app.post('/api/projeto/:nome/palavras/juntar', (req, res) => {
  const p = carregar(req.params.nome);
  if (!p) return res.status(404).json({ erro: 'projeto nao encontrado' });
  try {
    const palavra = juntarPalavra(p.fase1?.clipes || [], req.body || {});
    salvar(p);
    transmitir({ tipo: 'projeto', projeto: p });
    res.json({ palavra });
  } catch (e) {
    res.status(400).json({ erro: e.message });
  }
});

app.post('/api/projeto/:nome/palavras/empurrar', (req, res) => {
  const p = carregar(req.params.nome);
  if (!p) return res.status(404).json({ erro: 'projeto nao encontrado' });
  try {
    const palavras = empurrarPalavra(p.fase1?.clipes || [], req.body || {});
    salvar(p);
    transmitir({ tipo: 'projeto', projeto: p });
    res.json({ palavras });
  } catch (e) {
    res.status(400).json({ erro: e.message });
  }
});

// Exportacao (src/shared/legenda-export.js, puro): SRT por bloco do motor,
// ASS com karaoke `\k` por palavra. Nao grava nada em disco, so devolve.
app.get('/api/projeto/:nome/legenda.srt', (req, res) => {
  const p = carregar(req.params.nome);
  if (!p) return res.status(404).json({ erro: 'projeto nao encontrado' });
  const srt = gerarSrt(p.fase1?.clipes || [], p.estilo || {});
  res.set('Content-Disposition', `attachment; filename="${p.nome}.srt"`);
  res.type('text/plain; charset=utf-8').send(srt);
});

app.get('/api/projeto/:nome/legenda.ass', (req, res) => {
  const p = carregar(req.params.nome);
  if (!p) return res.status(404).json({ erro: 'projeto nao encontrado' });
  const ass = gerarAss(p.fase1?.clipes || [], p.estilo || {}, p.saida || SAIDA);
  res.set('Content-Disposition', `attachment; filename="${p.nome}.ass"`);
  res.type('text/plain; charset=utf-8').send(ass);
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
