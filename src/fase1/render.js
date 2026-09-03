import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ffmpeg } from '../shared/exec.js';
import {
  CORTE, SAIDA, CODEC, X264_PRESET, CRF,
} from '../shared/config.js';
import { corPadrao, montarFiltroCor } from '../shared/cor.js';

// Raiz do codigo (codigo/), derivada do proprio arquivo — nao de config.js,
// para nao mexer num arquivo de outra story ja entregue. Env `EDVID_LUTS`
// sobrepoe, do jeito que a VPS vai fazer no container.
const RAIZ_DO_CODIGO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const LUTS_DIR = process.env.EDVID_LUTS || path.join(RAIZ_DO_CODIGO, 'luts');

/**
 * Monta o filter_complex que corta os clipes, normaliza para 1080x1920 e concatena.
 * O ganho do HOOK entra por clipe, antes do concat, para valer so no trecho certo.
 * A cor (LUT + ajustes) entra uma vez so, depois do concat — mais barato que
 * repetir por clipe, e o resultado e identico porque e um filtro por frame.
 */
export function montarFiltro(clipes, {
  largura = SAIDA.largura, altura = SAIDA.altura, fps = SAIDA.fps, filtroCor = '',
} = {}) {
  const partes = [];
  const rotulos = [];

  clipes.forEach((c, i) => {
    const v = `v${i}`;
    const a = `a${i}`;
    partes.push(
      `[0:v]trim=start=${c.origemInicio}:end=${c.origemFim},setpts=PTS-STARTPTS,` +
      `scale=${largura}:${altura}:force_original_aspect_ratio=increase,` +
      `crop=${largura}:${altura},fps=${fps},format=yuv420p[${v}]`,
    );
    const ganho = c.bloco === 'HOOK' ? `,volume=${CORTE.ganhoHookDb}dB` : '';
    partes.push(
      `[0:a]atrim=start=${c.origemInicio}:end=${c.origemFim},asetpts=PTS-STARTPTS${ganho},` +
      `afade=t=in:st=0:d=0.012,afade=t=out:st=${Math.max(0, (c.origemFim - c.origemInicio) - 0.012).toFixed(3)}:d=0.012[${a}]`,
    );
    rotulos.push(`[${v}][${a}]`);
  });

  partes.push(`${rotulos.join('')}concat=n=${clipes.length}:v=1:a=1[vout][aconcat]`);
  partes.push(`[aconcat]loudnorm=I=${CORTE.lufsAlvo}:TP=-1.5:LRA=11[aout]`);
  if (filtroCor) partes.push(`[vout]${filtroCor}[vcor]`);

  return partes.join(';');
}

/** Renderiza o corte da Fase 1. Devolve o caminho do arquivo gerado. */
export async function renderizarCorte(origem, clipes, destino, { onProgresso, cor } = {}) {
  if (!clipes.length) throw new Error('Nenhum clipe para renderizar.');
  const filtroCor = montarFiltroCor(cor || corPadrao(), { pastaLuts: LUTS_DIR });
  const filtro = montarFiltro(clipes, { filtroCor });
  const rotuloVideo = filtroCor ? '[vcor]' : '[vout]';

  // O Mac usa VideoToolbox (hardware); o container Linux nao tem, entao cai
  // para libx264 por software, com preset e qualidade configuraveis por env.
  // Quadro-chave a cada 0,5 s: o Remotion extrai quadro a quadro deste arquivo
  // e o navegador arrasta a agulha nele; com o GOP padrao (4 s) cada busca
  // decodifica ate 120 quadros para achar um.
  const gop = ['-g', '15', '-keyint_min', '15', '-sc_threshold', '0'];
  const argsVideo = CODEC === 'libx264'
    ? ['-c:v', 'libx264', '-preset', X264_PRESET, '-crf', String(CRF), '-pix_fmt', 'yuv420p', ...gop]
    : ['-c:v', CODEC, '-b:v', '12M', ...gop];

  await ffmpeg([
    '-i', origem,
    '-filter_complex', filtro,
    '-map', rotuloVideo, '-map', '[aout]',
    ...argsVideo,
    '-c:a', 'aac', '-b:a', '192k',
    '-movflags', '+faststart',
    destino,
  ], {
    onLinha: (l) => {
      const m = l.match(/time=(\d+):(\d+):([\d.]+)/);
      if (m && onProgresso) {
        onProgresso(Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]));
      }
    },
  });

  return destino;
}

/**
 * Um quadro so, com a cor aplicada (ou nao) — usado no antes/depois do
 * preview de cor. `-ss` antes do `-i` para seek rapido, igual a gerarMiniaturas.
 */
export async function quadroComCor(origem, tempoS, cor, destinoJpg, { largura = 540 } = {}) {
  const filtroCor = montarFiltroCor(cor || corPadrao(), { pastaLuts: LUTS_DIR });
  const escala = `scale=${largura}:-2`;
  const vf = filtroCor ? `${escala},${filtroCor}` : escala;

  await ffmpeg([
    '-ss', String(tempoS), '-i', origem,
    '-frames:v', '1',
    '-vf', vf,
    destinoJpg,
  ]);

  return destinoJpg;
}

/**
 * Gera um filmstrip por clipe: varios frames lado a lado numa imagem so.
 * A timeline repete essa tira na horizontal, que e o visual de trilha de video.
 *
 * Um ffmpeg so por clipe (fps + scale + tile), sem frame temporario nenhum no
 * disco — o hstack de varios spawns virou um filtro so.
 */
export async function gerarMiniaturas(origem, clipes, pastaDestino) {
  const LARGURA_FRAME = 64;   // ~9:16 em 64x114
  const saidas = [];

  for (const c of clipes) {
    const arq = `${pastaDestino}/${c.id}.jpg`;
    const n = Math.min(6, Math.max(1, Math.round(c.duracao / 1.2)));
    const fps = n / c.duracao;

    await ffmpeg([
      '-ss', String(c.origemInicio), '-t', String(c.duracao), '-i', origem,
      '-vf', `fps=${fps},scale=${LARGURA_FRAME}:-2,tile=${n}x1`,
      '-frames:v', '1',
      arq,
    ]);
    saidas.push(arq);
  }
  return saidas;
}

/** Extrai os picos do audio do corte para desenhar a waveform no preview. */
export async function gerarPicos(arquivo, amostrasPorSegundo = 60) {
  const pcm = `${arquivo}.pcm`;
  await ffmpeg(['-i', arquivo, '-ac', '1', '-ar', '8000', '-f', 's16le', pcm]);
  const buf = fs.readFileSync(pcm);
  fs.unlinkSync(pcm);
  const amostras = Math.floor(buf.length / 2);
  const porBalde = Math.max(1, Math.floor(8000 / amostrasPorSegundo));
  const picos = [];
  for (let i = 0; i < amostras; i += porBalde) {
    let max = 0;
    for (let j = i; j < Math.min(i + porBalde, amostras); j++) {
      max = Math.max(max, Math.abs(buf.readInt16LE(j * 2)));
    }
    picos.push(Number((max / 32768).toFixed(3)));
  }
  return picos;
}
