// Proxy de pré-visualização: uma cópia leve do render, só para o player do
// navegador. O render final sai a ~6 Mbit/s com quadro-chave a cada 4 s; servido
// de uma VPS longe, o player engasga e o arrasto da agulha trava (o navegador
// decodifica até 4 s para achar o quadro). O proxy tem quadro-chave a cada meio
// segundo e um terço da taxa de bits. O arquivo pesado fica só para download.
import fs from 'node:fs';
import path from 'node:path';
import { ffmpeg } from './exec.js';

const env = (k, d) => (process.env[k] != null && process.env[k] !== '' ? process.env[k] : d);

export const PREVIEW = {
  largura: Number(env('EDVID_PREVIEW_LARGURA', 720)),
  altura: Number(env('EDVID_PREVIEW_ALTURA', 1280)),
  crf: Number(env('EDVID_PREVIEW_CRF', 27)),
  maxrate: env('EDVID_PREVIEW_MAXRATE', '1800k'),
  bufsize: env('EDVID_PREVIEW_BUFSIZE', '3600k'),
  gop: Number(env('EDVID_PREVIEW_GOP', 15)),
  audioKbps: Number(env('EDVID_PREVIEW_AUDIO_KBPS', 96)),
};

// Só os argumentos: função pura, testável sem ffmpeg. `ffmpeg()` já põe -y e
// -hide_banner. Vertical por padrão; vídeo horizontal ganha barras (pad), nunca
// corte, porque o proxy tem que mostrar exatamente o enquadramento do render.
export function argsPreview(origem, destino, o = PREVIEW) {
  const { largura, altura } = o;
  return [
    '-i', origem,
    '-vf', `scale=${largura}:${altura}:force_original_aspect_ratio=decrease,`
      + `pad=${largura}:${altura}:(ow-iw)/2:(oh-ih)/2,format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(o.crf),
    '-maxrate', o.maxrate, '-bufsize', o.bufsize,
    '-g', String(o.gop), '-keyint_min', String(o.gop), '-sc_threshold', '0',
    '-profile:v', 'main', '-level', '3.1',
    '-c:a', 'aac', '-b:a', `${o.audioKbps}k`, '-ac', '2',
    '-movflags', '+faststart',
    destino,
  ];
}

export function nomePreview(arquivo) {
  const ext = path.extname(arquivo);
  const base = path.basename(arquivo, ext);
  if (base === 'fase1-corte') return 'fase1-preview.mp4';
  if (base === 'fase2-final') return 'fase2-preview.mp4';
  return `${base}-preview.mp4`;
}

export async function gerarPreview(origem, destino, { onLinha } = {}) {
  if (!fs.existsSync(origem)) throw new Error(`preview: origem não existe: ${origem}`);
  await ffmpeg(argsPreview(origem, destino), { onLinha });
  return { destino, bytes: fs.statSync(destino).size };
}
