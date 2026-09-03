#!/usr/bin/env node
// Compara os dois caminhos de transcricao lado a lado — story C1.
//
// Roda o whisper.cpp local (se achar o binario e o modelo) e o sidecar
// `transcritor` (se TRANSCRITOR_URL responder), na MESMA wav, e imprime
// tempo, numero de palavras, texto continuo e as 10 primeiras palavras com
// tempo de cada um, pra comparacao visual manual.
//
// Sem dependencia nenhuma (nem das do projeto): so Node built-in, porque o
// objetivo e rodar em qualquer maquina (Mac de desenvolvimento ou VPS) sem
// precisar de `npm install` antes.
//
// Uso:
//   node scripts/comparar-transcricao.mjs caminho/para/fala.wav
//
// Variaveis de ambiente (mesmos nomes de src/shared/config.js):
//   WHISPER_CLI       binario do whisper.cpp (default: whisper-cli, precisa estar no PATH)
//   WHISPER_MODELO    modelo .bin do whisper.cpp (default: models/ggml-large-v3-turbo.bin
//                      dentro deste repo)
//   TRANSCRITOR_URL   endereco do sidecar (default: http://127.0.0.1:4822)

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.join(AQUI, '..');

const wav = process.argv[2];
if (!wav) {
  console.error('Uso: node scripts/comparar-transcricao.mjs caminho/para/fala.wav');
  process.exit(1);
}
if (!fs.existsSync(wav)) {
  console.error(`Arquivo nao encontrado: ${wav}`);
  process.exit(1);
}

const WHISPER_CLI = process.env.WHISPER_CLI || 'whisper-cli';
const WHISPER_MODELO = process.env.WHISPER_MODELO || path.join(RAIZ, 'models', 'ggml-large-v3-turbo.bin');
const TRANSCRITOR_URL = process.env.TRANSCRITOR_URL || 'http://127.0.0.1:4822';

/** Roda um comando e devolve { codigo, stdout, stderr }. Nunca rejeita. */
function rodar(cmd, args) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let p;
    try {
      p = spawn(cmd, args);
    } catch (e) {
      resolve({ codigo: -1, stdout: '', stderr: String(e) });
      return;
    }
    p.on('error', (e) => resolve({ codigo: -1, stdout, stderr: stderr + String(e) }));
    p.stdout.on('data', (d) => { stdout += d; });
    p.stderr.on('data', (d) => { stderr += d; });
    p.on('close', (codigo) => resolve({ codigo, stdout, stderr }));
  });
}

function achavel(cmd) {
  const onde = process.platform === 'win32' ? 'where' : 'which';
  return rodar(onde, [cmd]).then((r) => r.codigo === 0);
}

/** whisper.cpp local: -oj joga um .json com offsets em ms por palavra (--split-on-word). */
async function transcreverCpp(wav) {
  if (!(await achavel(WHISPER_CLI))) {
    return { disponivel: false, motivo: `${WHISPER_CLI} nao esta no PATH` };
  }
  if (!fs.existsSync(WHISPER_MODELO)) {
    return { disponivel: false, motivo: `modelo nao encontrado em ${WHISPER_MODELO}` };
  }

  const base = path.join(os.tmpdir(), `comparar-transcricao-cpp-${Date.now()}`);
  const t0 = Date.now();
  const r = await rodar(WHISPER_CLI, [
    '-m', WHISPER_MODELO, '-f', wav, '-l', 'pt', '-oj', '-of', base,
    '--max-len', '1', '--split-on-word',
    '-t', String(Math.max(4, os.cpus().length - 2)),
  ]);
  const tempoS = (Date.now() - t0) / 1000;

  if (r.codigo !== 0) {
    return { disponivel: false, motivo: `whisper-cli saiu com codigo ${r.codigo}: ${r.stderr.slice(-300)}` };
  }

  const j = JSON.parse(fs.readFileSync(`${base}.json`, 'utf8'));
  fs.rmSync(`${base}.json`, { force: true });
  const palavras = j.transcription
    .map((s) => ({ inicio: s.offsets.from / 1000, fim: s.offsets.to / 1000, texto: s.text.trim() }))
    .filter((p) => p.texto.length > 0);

  return { disponivel: true, tempoS, palavras };
}

/** Sidecar transcritor: multipart com o campo `audio`. */
async function transcreverSidecar(wav) {
  const url = `${TRANSCRITOR_URL}/transcrever`;
  const t0 = Date.now();
  let resposta;
  try {
    const forma = new FormData();
    forma.append('audio', new Blob([fs.readFileSync(wav)]), path.basename(wav));
    resposta = await fetch(url, { method: 'POST', body: forma });
  } catch (e) {
    return { disponivel: false, motivo: `nao respondeu em ${url}: ${e.message}` };
  }
  const tempoS = (Date.now() - t0) / 1000;
  if (!resposta.ok) {
    return { disponivel: false, motivo: `HTTP ${resposta.status} em ${url}` };
  }
  const j = await resposta.json();
  const palavras = (j.palavras || [])
    .map((p) => ({ inicio: p.inicio, fim: p.fim, texto: String(p.texto).trim() }))
    .filter((p) => p.texto.length > 0);
  return { disponivel: true, tempoS, palavras, tempoServidorS: j.tempo_s, modelo: j.modelo };
}

function imprimir(nome, resultado) {
  console.log(`\n=== ${nome} ===`);
  if (!resultado.disponivel) {
    console.log(`indisponivel: ${resultado.motivo}`);
    return;
  }
  const texto = resultado.palavras.map((p) => p.texto).join(' ');
  console.log(`tempo (parede): ${resultado.tempoS.toFixed(1)}s`
    + (resultado.tempoServidorS != null ? `  (servidor: ${resultado.tempoServidorS.toFixed(1)}s)` : '')
    + (resultado.modelo ? `  modelo: ${resultado.modelo}` : ''));
  console.log(`palavras: ${resultado.palavras.length}`);
  console.log(`texto: ${texto}`);
  console.log('10 primeiras palavras:');
  for (const p of resultado.palavras.slice(0, 10)) {
    console.log(`  ${p.inicio.toFixed(2)}-${p.fim.toFixed(2)}  ${JSON.stringify(p.texto)}`);
  }
}

console.log(`Comparando transcricao de ${wav}\n`);
const [cpp, sidecar] = await Promise.all([transcreverCpp(wav), transcreverSidecar(wav)]);
imprimir('whisper.cpp (local)', cpp);
imprimir(`transcritor (${TRANSCRITOR_URL})`, sidecar);
console.log('');
