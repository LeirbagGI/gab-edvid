import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ffmpeg, run } from '../shared/exec.js';
import {
  MODELO_WHISPER, WHISPER_CLI, WHISPER_MODO, TRANSCRITOR_URL, TIMEOUTS,
} from '../shared/config.js';

/** Extrai o audio do video em WAV 16k mono, que e o que o whisper aceita. */
export async function extrairWav(video, destino, { onLinha } = {}) {
  await ffmpeg(['-i', video, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', destino], { onLinha });
  return destino;
}

/**
 * Transcreve em nivel de palavra. Devolve [{ inicio, fim, texto }] em segundos.
 *
 * WHISPER_MODO=cpp (padrao, Mac do Gabriel) roda o whisper-cli local.
 * WHISPER_MODO=transcritor (VPS) chama o sidecar Python — nunca cai para o
 * cpp em caso de erro, porque o cpp nao existe la dentro do container.
 */
export async function transcreverPalavras(wav, pastaTrabalho, { idioma = 'pt', onLinha } = {}) {
  if (WHISPER_MODO === 'transcritor') {
    return transcreverViaSidecar(wav);
  }
  return transcreverViaCpp(wav, pastaTrabalho, { idioma, onLinha });
}

async function transcreverViaCpp(wav, pastaTrabalho, { idioma, onLinha }) {
  if (!fs.existsSync(MODELO_WHISPER)) {
    throw new Error(`Modelo do Whisper nao encontrado em ${MODELO_WHISPER}`);
  }
  const base = path.join(pastaTrabalho, 'transcricao');
  await run(WHISPER_CLI, [
    '-m', MODELO_WHISPER,
    '-f', wav,
    '-l', idioma,
    '-oj',
    '-of', base,
    '--max-len', '1',
    '--split-on-word',
    '-t', String(Math.max(4, os.cpus().length - 2)),
  ], { onLinha, timeoutMs: TIMEOUTS.whisper });

  const j = JSON.parse(fs.readFileSync(`${base}.json`, 'utf8'));
  return j.transcription
    .map((s) => ({
      inicio: s.offsets.from / 1000,
      fim: s.offsets.to / 1000,
      texto: s.text.trim(),
    }))
    .filter((p) => p.texto.length > 0);
}

/** Transcreve pelo sidecar Python (faster-whisper) que roda ao lado na VPS. */
async function transcreverViaSidecar(wav) {
  const url = `${TRANSCRITOR_URL}/transcrever`;
  const forma = new FormData();
  forma.append('audio', new Blob([fs.readFileSync(wav)]), path.basename(wav));

  let resposta;
  try {
    resposta = await fetch(url, {
      method: 'POST',
      body: forma,
      // Sem isto vale o headersTimeout padrao do undici (300 s), que e curto
      // demais para transcricao de video longo — ainda mais quando o sidecar
      // descarregou o modelo por ociosidade e precisa recarregar antes.
      signal: AbortSignal.timeout(TIMEOUTS.whisper),
    });
  } catch (e) {
    // O `catch` vazio de antes engolia a causa, e a mesma frase saia tanto
    // para container fora do ar (ECONNREFUSED) quanto para transcricao que
    // passou do tempo (UND_ERR_HEADERS_TIMEOUT / TimeoutError). Quando nao ha
    // acesso ssh a VPS essa mensagem e a unica pista que sobra.
    const causa = e?.cause?.code || e?.code || e?.name || e?.message;
    throw new Error(`transcritor nao respondeu em ${url} (${causa})`);
  }
  if (!resposta.ok) {
    throw new Error(`transcritor nao respondeu em ${url} (HTTP ${resposta.status})`);
  }

  const j = await resposta.json();
  return (j.palavras || [])
    .map((p) => ({ inicio: p.inicio, fim: p.fim, texto: String(p.texto).trim() }))
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
