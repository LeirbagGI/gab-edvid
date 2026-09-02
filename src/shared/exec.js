import { spawn } from 'node:child_process';

/**
 * Roda um comando e devolve stdout. Joga erro com stderr junto se o codigo != 0.
 * onLinha recebe cada linha de stderr — util para barra de progresso do ffmpeg.
 */
export function run(cmd, args, { onLinha, cwd } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => {
      const t = String(d);
      err += t;
      if (onLinha) t.split(/\r|\n/).filter(Boolean).forEach(onLinha);
    });
    p.on('error', reject);
    p.on('close', (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`${cmd} saiu com codigo ${code}\n${err.slice(-4000)}`));
    });
  });
}

export const ffmpeg = (args, opts) => run('ffmpeg', ['-hide_banner', '-y', ...args], opts);

export async function ffprobe(arquivo) {
  const out = await run('ffprobe', [
    '-v', 'error',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    arquivo,
  ]);
  const j = JSON.parse(out);
  const v = j.streams.find((s) => s.codec_type === 'video');
  const a = j.streams.find((s) => s.codec_type === 'audio');
  const [num, den] = (v?.r_frame_rate || '30/1').split('/').map(Number);
  return {
    duracao: Number(j.format.duration),
    tamanho: Number(j.format.size),
    largura: v?.width,
    altura: v?.height,
    fps: den ? num / den : 30,
    temAudio: Boolean(a),
    rotacao: Number(v?.side_data_list?.[0]?.rotation ?? 0),
  };
}
