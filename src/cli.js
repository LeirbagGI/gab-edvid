#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { PASTA_ENTRADA, PORTA_PREVIEW, PROJETOS, MODELO_WHISPER, RE_VIDEO } from './shared/config.js';
import { rodarFase1, refazerCorte, listar, carregar, nomeLivre } from './fase1/projeto.js';
import { rodarFase2 } from './fase2/render.js';

const VIDEO_RE = RE_VIDEO;

function ajuda() {
  console.log(`
Edvid — edicao de video assistida por IA

  npm run edvid                        Fase 1 no video mais novo da pasta de entrada
  npm run edvid -- <arquivo> [nome]    Fase 1 num arquivo especifico
  npm run edvid -- --lote              Fase 1 em TODOS os videos ainda nao processados
  npm run edvid -- --fase2 <nome>      renderiza a Fase 2 de um projeto aprovado
  npm run edvid -- --fase2-lote        Fase 2 em todos os projetos aprovados
  npm run edvid -- --refazer <nome>    refaz o corte com a timeline editada
  npm run edvid -- --listar            lista os projetos
  npm run preview                      preview + upload em http://localhost:${PORTA_PREVIEW}/

Pasta de entrada: ${PASTA_ENTRADA}
Projetos:         ${PROJETOS}
`);
}

async function avisarPreview(dados) {
  try {
    await fetch(`http://localhost:${PORTA_PREVIEW}/api/log`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(dados),
    });
  } catch { /* preview fechado */ }
}

function log(d) {
  const pct = d.pct != null ? ` ${d.pct.toFixed(0)}%` : '';
  process.stdout.write(`\r[${d.etapa}] ${d.msg}${pct}`.padEnd(78));
  if (d.pct == null) process.stdout.write('\n');
  avisarPreview(d);
}

function videosDaEntrada() {
  if (!fs.existsSync(PASTA_ENTRADA)) {
    fs.mkdirSync(PASTA_ENTRADA, { recursive: true });
    return [];
  }
  return fs.readdirSync(PASTA_ENTRADA)
    .filter((f) => VIDEO_RE.test(f) && !f.startsWith('.'))
    .map((f) => path.join(PASTA_ENTRADA, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
}

const args = process.argv.slice(2);
const flag = (n) => args[args.indexOf(n) + 1];

if (args.includes('--ajuda') || args.includes('-h')) {
  ajuda();

} else if (args.includes('--listar')) {
  const l = listar();
  if (!l.length) console.log('Nenhum projeto ainda.');
  l.forEach((p) => console.log(
    `${p.nome.padEnd(30)} ${String(p.fase1?.duracao ?? '-').padStart(6)}s  ` +
    `f1:${(p.fase1?.status || '-').padEnd(21)} f2:${p.fase2?.status || 'nao-iniciada'}`,
  ));

} else if (args.includes('--refazer')) {
  const nome = flag('--refazer');
  if (!nome) { console.error('Uso: npm run edvid -- --refazer "<projeto>"'); process.exit(1); }
  const p = await refazerCorte(nome, { log });
  console.log(`\nCorte refeito: ${p.fase1.duracao}s.`);

} else if (args.includes('--fase2')) {
  const nome = flag('--fase2');
  if (!nome) { console.error('Uso: npm run edvid -- --fase2 "<projeto>"'); process.exit(1); }
  const p = await rodarFase2(nome, { log });
  console.log(`\nFase 2: ${path.join(PROJETOS, nome, p.fase2.arquivo)}`);
  p.fase2.avisos?.forEach((a) => console.log(`  aviso: ${a}`));

} else if (args.includes('--fase2-lote')) {
  const alvos = listar().filter((p) => p.fase1?.status === 'aprovada' && p.fase2?.status !== 'pronta');
  if (!alvos.length) {
    console.log('Nenhum projeto aprovado esperando a Fase 2.');
  } else {
    console.log(`Fase 2 em ${alvos.length} projeto(s).\n`);
    for (const [i, p] of alvos.entries()) {
      console.log(`\n[${i + 1}/${alvos.length}] ${p.nome}`);
      try {
        const r = await rodarFase2(p.nome, { log });
        r.fase2.avisos?.forEach((a) => console.log(`  aviso: ${a}`));
      } catch (e) {
        console.error(`  erro: ${e.message}`);
      }
    }
  }

} else if (args.includes('--lote')) {
  const jaFeitos = new Set(listar().map((p) => p.origem.caminho));
  const novos = videosDaEntrada().filter((a) => !jaFeitos.has(a));
  if (!novos.length) {
    console.log(`Nada novo em ${PASTA_ENTRADA}.`);
  } else {
    console.log(`Fase 1 em ${novos.length} video(s).\n`);
    for (const [i, arquivo] of novos.entries()) {
      const nome = nomeLivre(arquivo);
      console.log(`\n[${i + 1}/${novos.length}] ${nome}`);
      try {
        const p = await rodarFase1(arquivo, nome, { log });
        console.log(`  ${p.fase1.duracao}s, ${p.fase1.clipes.length} clipes`);
      } catch (e) {
        console.error(`  erro: ${e.message}`);
      }
    }
    console.log(`\nAbra http://localhost:${PORTA_PREVIEW}/ para aprovar os cortes.`);
  }

} else {
  if (!fs.existsSync(MODELO_WHISPER)) {
    console.error(`Modelo do Whisper faltando: ${MODELO_WHISPER}`);
    process.exit(1);
  }
  const alvo = args.find((a) => !a.startsWith('-')) || videosDaEntrada()[0];
  if (!alvo) {
    console.error(`Nenhum video em ${PASTA_ENTRADA}. Jogue um .MOV ou .MP4 la e rode de novo.`);
    process.exit(1);
  }
  if (!fs.existsSync(alvo)) { console.error(`Arquivo nao encontrado: ${alvo}`); process.exit(1); }

  // O segundo argumento so vale como nome se for um nome mesmo. Um `*` que
  // expandiu em varios arquivos mandava um CAMINHO para ca, e o projeto era
  // criado como "projetos/Users/gabrielnunes/Desktop/...".
  const candidato = args.find((a, i) => i > 0 && !a.startsWith('-') && a !== alvo);
  const pareceCaminho = candidato
    && (candidato.includes('/') || fs.existsSync(candidato) || VIDEO_RE.test(candidato));
  if (candidato && pareceCaminho) {
    console.error(`\n  "${path.basename(candidato)}" parece um arquivo, não um nome de projeto.`);
    console.error('  Mande um vídeo por vez, ou use --lote para processar todos:\n');
    console.error('    npm run edvid -- --lote\n');
    process.exit(1);
  }
  const nome = candidato || nomeLivre(alvo);
  console.log(`Origem:  ${alvo}\nProjeto: ${nome}\n`);

  const t0 = Date.now();
  const projeto = await rodarFase1(alvo, nome, { log });
  console.log(`\n
Corte: ${projeto.fase1.duracao}s a partir de ${projeto.origem.duracao.toFixed(0)}s de bruto
Clipes: ${projeto.fase1.clipes.length} (${projeto.fase1.clipes.map((c) => c.bloco).join(' > ')})
Removidos: ${projeto.fase1.descartados.length} trechos
Tempo: ${((Date.now() - t0) / 1000).toFixed(0)}s

Abra http://localhost:${PORTA_PREVIEW}/ para aprovar o corte.`);
}
