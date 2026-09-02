import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { argsPreview, nomePreview, gerarPreview } from './preview.js';

test('argsPreview monta os parametros do proxy', () => {
  const a = argsPreview('in.mp4', 'out.mp4');
  const s = a.join(' ');
  assert.ok(s.includes('-g 15'));
  assert.ok(s.includes('-crf 27'));
  assert.ok(s.includes('scale=720:1280'));
  assert.equal(a.at(-1), 'out.mp4');
});

test('nomePreview', () => {
  assert.equal(nomePreview('fase1-corte.mp4'), 'fase1-preview.mp4');
  assert.equal(nomePreview('fase2-final.mp4'), 'fase2-preview.mp4');
  assert.equal(nomePreview('x/qualquer.mov'), 'qualquer-preview.mp4');
});

const temFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

test('gera proxy 720x1280 com quadro-chave frequente', { skip: !temFfmpeg }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edvid-preview-'));
  const origem = path.join(dir, 'in.mp4');
  const destino = path.join(dir, 'out.mp4');
  spawnSync('ffmpeg', ['-hide_banner', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1080x1920:rate=30',
    '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '3', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-preset', 'veryfast', '-c:a', 'aac', origem]);
  const r = await gerarPreview(origem, destino);
  assert.ok(r.bytes > 0);
  const dim = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', destino]).stdout.toString().trim();
  assert.equal(dim, '720,1280');
  const chaves = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'frame=key_frame', '-of', 'csv=p=0', destino]).stdout.toString().split('\n').filter((l) => l.trim() === '1').length;
  assert.ok(chaves >= 5, `quadros-chave: ${chaves}`);
  fs.rmSync(dir, { recursive: true, force: true });
});
