import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ffmpeg, run } from '../shared/exec.js';
import { MODELO_WHISPER } from '../shared/config.js';

/** Extrai o audio do video em WAV 16k mono, que e o que o whisper.cpp aceita. */
export async function extrairWav(video, destino, { onLinha } = {}) {
  await ffmpeg(['-i', video, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', destino], { onLinha });
  return destino;
}

/**
 * Transcreve com whisper.cpp em nivel de palavra.
 * Devolve [{ inicio, fim, texto }] em segundos.
 */
export async function transcreverPalavras(wav, pastaTrabalho, { idioma = 'pt', onLinha } = {}) {
  if (!fs.existsSync(MODELO_WHISPER)) {
    throw new Error(`Modelo do Whisper nao encontrado em ${MODELO_WHISPER}`);
  }
  const base = path.join(pastaTrabalho, 'transcricao');
  await run('whisper-cli', [
    '-m', MODELO_WHISPER,
    '-f', wav,
    '-l', idioma,
    '-oj',
    '-of', base,
    '--max-len', '1',
    '--split-on-word',
    '-t', String(Math.max(4, os.cpus().length - 2)),
  ], { onLinha });

  const j = JSON.parse(fs.readFileSync(`${base}.json`, 'utf8'));
  return j.transcription
    .map((s) => ({
      inicio: s.offsets.from / 1000,
      fim: s.offsets.to / 1000,
      texto: s.text.trim(),
    }))
    .filter((p) => p.texto.length > 0);
}

/** Volume medio do audio, em dB. Base para calibrar o limiar de pausa. */
async function volumeMedio(wav) {
  let log = '';
  await ffmpeg(['-i', wav, '-af', 'volumedetect', '-f', 'null', '-'],
    { onLinha: (l) => { log += `${l}\n`; } });
  const m = log.match(/mean_volume:\s*(-?[\d.]+)/);
  return m ? Number(m[1]) : -20;
}

/** Roda o silencedetect num limiar e devolve os intervalos. */
async function medir(wav, db, duracaoMin) {
  let log = '';
  await ffmpeg(['-i', wav, '-af', `silencedetect=noise=${db}dB:d=${duracaoMin}`, '-f', 'null', '-'],
    { onLinha: (l) => { log += `${l}\n`; } });
  const silencios = [];
  let atual = null;
  for (const linha of log.split('\n')) {
    const ini = linha.match(/silence_start:\s*(-?[\d.]+)/);
    if (ini) atual = { inicio: Math.max(0, Number(ini[1])) };
    const fim = linha.match(/silence_end:\s*([\d.]+)/);
    if (fim && atual) { atual.fim = Number(fim[1]); silencios.push(atual); atual = null; }
  }
  return silencios;
}

/**
 * Acha as pausas da fala.
 *
 * Um limiar fixo (-32 dB) so funciona em gravacao com silencio de verdade. Num
 * carro, na rua, com ar-condicionado, o ruido de fundo fica ACIMA disso e a
 * pausa nunca e detectada — o video sai sem corte nenhum.
 *
 * Entao o limiar e calibrado pelo proprio audio: varre a partir do volume medio
 * e fica com o que remove mais tempo sem passar do teto. Passar do teto quer
 * dizer que comecou a cortar fala, nao pausa.
 */
export async function detectarSilencios(wav, {
  duracaoMin = 0.18,
  tetoFracao = 0.22,   // no maximo 22% do video vira pausa
  pisoFracao = 0.02,   // abaixo de 2% nao vale o esforco
} = {}) {
  const media = await volumeMedio(wav);
  const duracao = await duracaoDo(wav);

  let melhor = [];
  for (const rel of [-6, -3, 0, 2, 3, 4, 5, 6, 7]) {
    const achados = await medir(wav, (media + rel).toFixed(1), duracaoMin);
    const total = achados.reduce((t, s) => t + (s.fim - s.inicio), 0);
    const fracao = duracao ? total / duracao : 0;
    if (fracao > tetoFracao) break;          // passou do teto: o anterior era o bom
    if (fracao >= pisoFracao) melhor = achados;
  }
  return melhor;
}

async function duracaoDo(wav) {
  const { ffprobe } = await import('../shared/exec.js');
  return (await ffprobe(wav)).duracao || 0;
}
