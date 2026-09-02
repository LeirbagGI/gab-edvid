import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition, makeCancelSignal } from '@remotion/renderer';
import {
  BUNDLE_DIR, REMOTION_CONCURRENCY, X264_PRESET, CRF, TIMEOUTS,
} from '../shared/config.js';
import { caminhoProjeto, carregar, salvar } from '../fase1/projeto.js';
import { gerarPicos } from '../fase1/render.js';
import { ffprobe } from '../shared/exec.js';
import { narra, acao, seg } from '../shared/conversa.js';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const ENTRADA = path.join(aqui, '..', '..', 'remotion', 'index.jsx');
const CACHE_BUNDLE = BUNDLE_DIR;

// Empacotar o Remotion leva ~20 s; um bundle so serve para todos os projetos,
// que e o que torna o processamento em lote viavel.
let bundlePronto = null;
let assinaturaBundle = '';

/**
 * Assinatura das fontes da composicao. Sem isso, editar remotion/ com o
 * servidor de pe renderizaria com o bundle velho ate reiniciar o processo.
 */
function assinaturaDaComposicao() {
  const alvos = [
    path.join(aqui, '..', '..', 'remotion'),
    path.join(aqui, '..', 'shared'),
  ];
  const marcas = [];
  for (const dir of alvos) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).sort()) {
      if (!/\.(jsx?|mjs)$/.test(f)) continue;
      marcas.push(`${f}:${fs.statSync(path.join(dir, f)).mtimeMs}`);
    }
  }
  return marcas.join('|');
}

export async function prepararBundle({ onLinha } = {}) {
  const assinatura = assinaturaDaComposicao();
  if (bundlePronto && assinatura === assinaturaBundle) return bundlePronto;
  if (bundlePronto) onLinha?.('composicao mudou, empacotando de novo');
  assinaturaBundle = assinatura;
  bundlePronto = bundle({
    entryPoint: ENTRADA,
    outDir: CACHE_BUNDLE,
    onProgress: (p) => onLinha?.(`empacotando ${p}%`),
  });
  return bundlePronto;
}

/** Zera o bundle — use depois de mexer nos arquivos de remotion/. */
export function invalidarBundle() {
  bundlePronto = null;
  fs.rmSync(CACHE_BUNDLE, { recursive: true, force: true });
}

/**
 * O Remotion serve staticFile() de <bundle>/public e ignora o publicDir do
 * renderMedia quando o serveUrl e uma pasta local. Entao apontamos esse
 * caminho para a pasta do projeto por symlink, um projeto de cada vez.
 *
 * E por isso que a fila roda serial: dois renders ao mesmo tempo brigariam
 * por esse link.
 */
function apontarPublicPara(pastaProjeto) {
  const alvo = path.join(CACHE_BUNDLE, 'public');
  fs.rmSync(alvo, { recursive: true, force: true });
  fs.symlinkSync(pastaProjeto, alvo, 'dir');
}

/** Sugere a headline a partir da primeira fala, cortada em duas linhas. */
export function headlinePadrao(projeto) {
  const hook = (projeto.fase1.clipes || []).find((c) => c.bloco === 'HOOK');
  if (!hook) return '';
  const limpo = hook.texto.replace(/["“”]/g, '').replace(/[.,;:]$/, '');
  const palavras = limpo.split(/\s+/).slice(0, 8);
  const meio = Math.ceil(palavras.length / 2);
  return `${palavras.slice(0, meio).join(' ')}\n${palavras.slice(meio).join(' ')}`.trim();
}

/** Imagens de b-roll que o usuario deixou em projetos/<nome>/broll/. */
export function lerBroll(nome) {
  const pasta = path.join(caminhoProjeto(nome), 'broll');
  if (!fs.existsSync(pasta)) return [];
  return fs.readdirSync(pasta)
    .filter((f) => /\.(jpe?g|png|webp)$/i.test(f) && !f.startsWith('.'))
    .sort();
}

/** Trilha do projeto (projetos/<nome>/trilha.mp3) ou nada. */
export function lerTrilha(nome) {
  const pasta = caminhoProjeto(nome);
  const achou = ['trilha.mp3', 'trilha.m4a', 'trilha.wav']
    .find((f) => fs.existsSync(path.join(pasta, f)));
  return achou || null;
}

/**
 * Renderiza a Fase 2. Usa a pasta do projeto como publicDir do Remotion,
 * entao staticFile('fase1-corte.mp4') e staticFile('broll/x.jpg') funcionam.
 */
export async function rodarFase2(nome, { log = () => {} } = {}) {
  const projeto = carregar(nome);
  if (!projeto) throw new Error(`Projeto "${nome}" nao encontrado.`);
  if (projeto.fase1?.status !== 'aprovada') {
    throw new Error('A Fase 1 precisa estar aprovada antes da Fase 2.');
  }

  const pasta = caminhoProjeto(nome);
  const saida = path.join(pasta, 'fase2-final.mp4');

  // Completa o que a Fase 2 precisa e ainda nao foi decidido.
  projeto.fase2 = {
    ...projeto.fase2,
    headline: projeto.fase2?.headline ?? headlinePadrao(projeto),
    broll: lerBroll(nome),
    trilha: lerTrilha(nome),
    status: 'renderizando',
  };
  salvar(projeto);

  const avisos = [];
  const el = projeto.estilo?.elementos || {};
  if (el.trilhaSonoraComIA && !projeto.fase2.trilha) {
    avisos.push('Trilha ligada mas nenhum arquivo trilha.mp3 na pasta do projeto — saiu sem musica.');
  }
  if (projeto.estilo?.tipoEdicao !== 'limpa' && !projeto.fase2.broll.length) {
    avisos.push('Tela dividida ligada mas a pasta broll/ esta vazia — saiu como Limpa.');
  }

  log({ etapa: 'bundle', msg: 'Preparando o Remotion' });
  const servedUrl = await prepararBundle({
    onLinha: (m) => log({ etapa: 'bundle', msg: m }),
  });

  apontarPublicPara(pasta);

  log({ etapa: 'fase2', msg: 'Montando a composicao' });
  const composicao = await selectComposition({
    serveUrl: servedUrl,
    id: 'Reel',
    inputProps: { projeto },
  });

  log({ etapa: 'fase2', msg: 'Renderizando a Fase 2' });
  const { cancelSignal, cancel } = makeCancelSignal();
  let estourou = false;
  const temporizador = setTimeout(() => { estourou = true; cancel(); }, TIMEOUTS.render);
  try {
    await renderMedia({
      composition: composicao,
      serveUrl: servedUrl,
      codec: 'h264',
      outputLocation: saida,
      inputProps: { projeto },
      concurrency: REMOTION_CONCURRENCY,
      x264Preset: X264_PRESET,
      crf: CRF,
      cancelSignal,
      onProgress: ({ progress }) => log({
        etapa: 'fase2', msg: 'Renderizando a Fase 2', pct: progress * 100,
      }),
    });
  } catch (e) {
    if (estourou) throw new Error('tempo esgotado: render da fase 2');
    throw e;
  } finally {
    clearTimeout(temporizador);
  }

  // A aba Fase 2 desenha a timeline do video final, entao ela precisa da
  // waveform e da duracao reais do arquivo entregue.
  log({ etapa: 'fase2', msg: 'Desenhando a waveform do final' });
  const picos = await gerarPicos(saida);
  const infoFinal = await ffprobe(saida);

  const atual = carregar(nome);
  atual.fase2 = {
    ...projeto.fase2,
    status: 'pronta',
    picos,
    duracao: Number(infoFinal.duracao.toFixed(2)),
    arquivo: path.relative(pasta, saida),
    renderizadaEm: new Date().toISOString(),
    avisos,
  };
  salvar(atual);

  const el2 = atual.estilo?.elementos || {};
  const ligados = Object.entries(el2).filter(([, v]) => v).map(([k]) => k);
  narra(atual, `Fase 2 pronta — ${path.basename(saida)}, ${seg(atual.fase1.duracao)}. `
    + `Apliquei headline ${atual.estilo.estiloHeadline}, legenda ${atual.estilo.estiloLegenda} `
    + `na cor ${atual.estilo.corDestaque}, e ${ligados.length} elemento(s) de edição.`);
  acao(atual, {
    arquivo: path.basename(saida), ferramentas: 1,
    mais: Math.round(atual.fase1.duracao * (atual.saida?.fps || 30)), menos: 0,
    detalhe: `${Math.round(atual.fase1.duracao * (atual.saida?.fps || 30))} quadros renderizados `
      + `em ${atual.saida?.largura}×${atual.saida?.altura}.`,
  });
  avisos.forEach((a) => narra(atual, `Aviso: ${a}`));
  salvar(atual);

  log({ etapa: 'pronto', msg: `Fase 2 pronta — ${path.basename(saida)}` });
  return atual;
}
