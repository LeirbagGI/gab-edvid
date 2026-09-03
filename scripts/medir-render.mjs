#!/usr/bin/env node
// Mede o desempenho do render da Fase 2 (Remotion) — story H3.
//
// Cria, em pasta temporaria, um projeto sintetico de 20s (testsrc2 1080x1920
// 30fps + audio senoidal, 5 clipes de 4s com "palavras" inventadas, 4 por
// segundo) e roda a funcao REAL `rodarFase2` (a mesma que a fila usa) em
// cinco cenarios crescentes de carga, imprimindo tempo de bundle, tempo de
// render, fps efetivo e tamanho do arquivo de cada um.
//
// Uso:
//   node scripts/medir-render.mjs            # roda os 5 cenarios (a..e)
//   node scripts/medir-render.mjs d e        # so os cenarios pedidos
//
// EDVID_RAIZ e sempre sobrescrito para uma pasta temporaria nova — este
// script nunca toca em `~/gab-edvid` nem em projetos de verdade. As demais
// variaveis (REMOTION_CONCURRENCY, EDVID_JPEG_QUALIDADE, EDVID_GL,
// EDVID_X264_PRESET, EDVID_QUALIDADE...) sao lidas do ambiente que chamou o
// script, exatamente como o servidor le — e assim que se compara uma opcao
// contra outra: `EDVID_GL=swangle node scripts/medir-render.mjs d`.
//
// Medido no Mac de desenvolvimento (10 vCPU, com aceleracao de video do
// sistema disponivel para o ffmpeg dos passos de waveform/preview, mas NAO
// para o render do Remotion em si, que aqui roda em libx264 por software
// igual na VPS). A VPS de producao (3 vCPU, sem GPU) tende a rodar esta
// mesma carga uns 3x mais devagar — os numeros deste script servem para
// comparar cenario contra cenario e opcao contra opcao, nao como tempo final
// de VPS.

import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'edvid-medir-'));
process.env.EDVID_RAIZ = TMP;

// So depois de setar EDVID_RAIZ importamos os modulos reais — config.js le a
// env na hora do import, e um import estatico no topo do arquivo rodaria
// antes da linha acima.
const { rodarFase2, aquecerBundle } = await import('../src/fase2/render.js');
const { caminhoProjeto, salvar } = await import('../src/fase1/projeto.js');
const { SAIDA } = await import('../src/shared/config.js');
const { ffmpeg } = await import('../src/shared/exec.js');

const FONTE = path.join(TMP, 'fonte.mp4');
const DURACAO_TOTAL = 20; // s
const CLIPES_N = 5;
const DURACAO_CLIPE = DURACAO_TOTAL / CLIPES_N; // 4s
const PALAVRAS_POR_S = 4;

const PALAVRAS = [
  'isso', 'aqui', 'agora', 'muito', 'rapido', 'bem', 'forte', 'claro',
  'sempre', 'entao', 'olha', 'vamos', 'junto', 'com', 'forca', 'total',
];

const CENARIOS = [
  { id: 'a', nome: 'sem nada', opts: {} },
  { id: 'b', nome: 'legenda hormozi', opts: { legenda: 'hormozi' } },
  {
    id: 'c',
    nome: 'b + transicao zoom-punch',
    opts: { legenda: 'hormozi', transicaoTipo: 'zoom-punch' },
  },
  {
    id: 'd',
    nome: 'c + grao 0,35 + vinheta 0,5 + barra de progresso',
    opts: {
      legenda: 'hormozi',
      transicaoTipo: 'zoom-punch',
      efeitos: { grao: 0.35, vinheta: 0.5, barraProgresso: { posicao: 'base' } },
    },
  },
  {
    id: 'e',
    nome: 'd, com EDVID_QUALIDADE=prova',
    opts: {
      legenda: 'hormozi',
      transicaoTipo: 'zoom-punch',
      efeitos: { grao: 0.35, vinheta: 0.5, barraProgresso: { posicao: 'base' } },
    },
    qualidade: 'prova',
  },
];

/** 5 clipes de 4s, 16 palavras cada (4/s), texto inventado em rodizio. */
function construirClipes() {
  const blocos = ['HOOK', 'DINAMICA', 'RECURSOS', 'DINAMICA', 'CTA'];
  const clipes = [];
  for (let i = 0; i < CLIPES_N; i++) {
    const inicio = i * DURACAO_CLIPE;
    const fim = inicio + DURACAO_CLIPE;
    const nPalavras = Math.round(DURACAO_CLIPE * PALAVRAS_POR_S);
    const palavras = [];
    for (let k = 0; k < nPalavras; k++) {
      const pIni = inicio + k / PALAVRAS_POR_S;
      palavras.push({
        texto: PALAVRAS[(i * nPalavras + k) % PALAVRAS.length],
        inicio: Number(pIni.toFixed(3)),
        fim: Number((pIni + 1 / PALAVRAS_POR_S - 0.03).toFixed(3)),
        destaque: k % 5 === 0,
      });
    }
    clipes.push({
      inicio, fim, duracao: DURACAO_CLIPE, bloco: blocos[i], ativo: true, palavras,
    });
  }
  return clipes;
}

/** Projeto sintetico minimo, so com o que `rodarFase2` precisa ler. */
function construirProjeto(nome, {
  legenda = 'sem-legenda', transicaoTipo = null, efeitos = {},
  headline = 'Teste de\nperformance H3',
} = {}) {
  return {
    nome,
    criadoEm: new Date().toISOString(),
    origem: {
      arquivo: 'fonte-original.mp4', duracao: DURACAO_TOTAL,
      largura: SAIDA.largura, altura: SAIDA.altura, fps: SAIDA.fps,
    },
    saida: { ...SAIDA },
    fase1: {
      status: 'aprovada',
      arquivo: 'fase1-corte.mp4',
      duracao: DURACAO_TOTAL,
      clipes: construirClipes(),
    },
    estilo: {
      tipoEdicao: 'limpa',
      corDestaque: '#EE7533',
      estiloHeadline: 'caixa-branca',
      estiloLegenda: legenda,
      elementos: {
        movimentoTracking: false,
        automacaoZoomIn: true,
        zoomInOutNosCortes: true,
        trilhaSonoraComIA: false,
        flashNaTransicao: false,
      },
      efeitos,
      ...(transicaoTipo ? { transicao: { tipo: transicaoTipo } } : {}),
    },
    fase2: { headline, broll: [], trilha: null },
  };
}

async function gerarClipeSintetico(destino) {
  await ffmpeg([
    '-f', 'lavfi', '-i', `testsrc2=size=${SAIDA.largura}x${SAIDA.altura}:rate=${SAIDA.fps}:duration=${DURACAO_TOTAL}`,
    '-f', 'lavfi', '-i', `sine=frequency=440:duration=${DURACAO_TOTAL}`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-shortest',
    destino,
  ]);
}

async function medirCenario(cenario) {
  const nome = `medir-${cenario.id}`;
  const pasta = caminhoProjeto(nome);
  fs.mkdirSync(pasta, { recursive: true });
  fs.copyFileSync(FONTE, path.join(pasta, 'fase1-corte.mp4'));
  salvar(construirProjeto(nome, cenario.opts));

  const marcos = [];
  const log = (d) => marcos.push({ t: Date.now(), ...d });

  const t0 = Date.now();
  const resultado = await rodarFase2(nome, {
    log, ...(cenario.qualidade ? { qualidade: cenario.qualidade } : {}),
  });
  const t1 = Date.now();

  const acharT = (pred) => marcos.find(pred)?.t;
  const bundleInicio = acharT((m) => m.etapa === 'bundle') ?? t0;
  const renderInicio = acharT((m) => m.etapa === 'fase2'
    && /^Renderizando/.test(m.msg || '')) ?? bundleInicio;
  const renderFim = acharT((m) => m.etapa === 'fase2' && m.msg === 'Desenhando a waveform do final')
    ?? acharT((m) => m.etapa === 'pronto')
    ?? t1;

  const arquivoRel = cenario.qualidade === 'prova' ? resultado.fase2.prova : resultado.fase2.arquivo;
  const caminhoSaida = path.join(pasta, arquivoRel);
  const tamanho = fs.statSync(caminhoSaida).size;
  const totalFrames = Math.round(DURACAO_TOTAL * SAIDA.fps);
  const renderSeg = Math.max(0.001, (renderFim - renderInicio) / 1000);

  return {
    id: cenario.id,
    nome: cenario.nome,
    bundleSeg: Math.max(0, (renderInicio - bundleInicio) / 1000),
    renderSeg,
    fps: totalFrames / renderSeg,
    tamanhoMB: tamanho / (1024 * 1024),
    totalSeg: (t1 - t0) / 1000,
    caminhoSaida,
  };
}

function tabela(linhas) {
  const cab = ['Cenário', 'Bundle (s)', 'Render (s)', 'FPS efetivo', 'Tamanho (MB)', 'Total (s)'];
  const dados = linhas.map((l) => [
    `${l.id}) ${l.nome}`,
    l.bundleSeg.toFixed(1),
    l.renderSeg.toFixed(1),
    l.fps.toFixed(1),
    l.tamanhoMB.toFixed(2),
    l.totalSeg.toFixed(1),
  ]);
  const larguras = cab.map((c, i) => Math.max(c.length, ...dados.map((d) => d[i].length)));
  const linha = (cols) => cols.map((c, i) => String(c).padEnd(larguras[i])).join('  ');
  console.log(linha(cab));
  console.log(larguras.map((w) => '-'.repeat(w)).join('  '));
  dados.forEach((d) => console.log(linha(d)));
}

async function main() {
  const filtro = process.argv.slice(2);
  const alvo = filtro.length ? CENARIOS.filter((c) => filtro.includes(c.id)) : CENARIOS;
  if (!alvo.length) {
    console.error(`cenario(s) desconhecido(s): ${filtro.join(', ')} — use a, b, c, d ou e`);
    process.exit(1);
  }

  console.log(`Pasta temporária: ${TMP}`);
  console.log(`EDVID_RAIZ=${process.env.EDVID_RAIZ}`);
  console.log('Gerando clipe sintético (testsrc2 1080x1920 30fps, 20s, áudio senoidal)...');
  await gerarClipeSintetico(FONTE);

  console.log('Aquecendo o bundle do Remotion...');
  const tAquecer0 = Date.now();
  // `aquecerBundle` e uma exportacao nova (H3) — a defesa aqui deixa este
  // mesmo script medir tambem uma revisao anterior do render.js, sem export.
  if (typeof aquecerBundle === 'function') await aquecerBundle();
  console.log(`Bundle a frio pronto em ${((Date.now() - tAquecer0) / 1000).toFixed(1)}s.`);

  const resultados = [];
  for (const cenario of alvo) {
    console.log(`\n=== Cenário ${cenario.id}: ${cenario.nome} ===`);
    // eslint-disable-next-line no-await-in-loop
    const r = await medirCenario(cenario);
    resultados.push(r);
    console.log(`bundle ${r.bundleSeg.toFixed(1)}s · render ${r.renderSeg.toFixed(1)}s · `
      + `${r.fps.toFixed(1)} fps · ${r.tamanhoMB.toFixed(2)} MB · arquivo: ${r.caminhoSaida}`);
  }

  console.log('\nResumo:');
  tabela(resultados);
  console.log(`\nProjetos e arquivos renderizados ficaram em: ${TMP}`);
  console.log('Nota: medido no Mac de desenvolvimento (10 vCPU). A VPS de produção (3 vCPU, sem GPU) '
    + 'tende a rodar esta mesma carga uns 3x mais devagar — compare cenário contra cenário aqui, não '
    + 'como tempo final de VPS.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
