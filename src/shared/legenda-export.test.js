import assert from 'node:assert/strict';
import test from 'node:test';
import { gerarSrt, gerarAss } from './legenda-export.js';

function clipesTeste() {
  return [
    {
      id: 'c1', ativo: true, inicio: 0, fim: 2,
      palavras: [
        { texto: 'É', inicio: 1.2, fim: 1.35 },
        { texto: 'assim', inicio: 1.35, fim: 1.7 },
        { texto: 'que', inicio: 1.7, fim: 1.9 },
      ],
    },
    {
      id: 'c2', ativo: true, inicio: 2, fim: 4,
      palavras: [
        { texto: 'funciona', inicio: 2.1, fim: 2.6 },
      ],
    },
    // clipe desligado: nunca deve entrar na exportacao.
    {
      id: 'c3', ativo: false, inicio: 4, fim: 5,
      palavras: [{ texto: 'fora', inicio: 4.1, fim: 4.4 }],
    },
  ];
}

test('gerarSrt: timestamp no formato HH:MM:SS,mmm e blocos numerados', () => {
  const srt = gerarSrt(clipesTeste(), { estiloLegenda: 'karaoke' });
  assert.match(srt, /^1\n\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3}\n/);
  assert.match(srt, /00:00:01,200 --> /);
});

test('gerarSrt: palavra oculta some do bloco, mas nao quebra o resto', () => {
  const clipes = clipesTeste();
  clipes[0].palavras[1].oculta = true; // "assim" oculta
  const srt = gerarSrt(clipes, { estiloLegenda: 'karaoke' });
  assert.ok(!srt.includes('assim'));
  assert.ok(srt.includes('É'));
  assert.ok(srt.includes('que'));
});

test('gerarSrt: clipe desligado nao entra na exportacao', () => {
  const srt = gerarSrt(clipesTeste(), { estiloLegenda: 'karaoke' });
  assert.ok(!srt.includes('fora'));
});

test('gerarSrt: estilo.legenda.maxPalavras sobrescreve o agrupamento do preset', () => {
  // "karaoke" e legado (janela 3) -> maxPalavras default 3; forcando 1, cada
  // palavra vira o proprio bloco.
  const srt = gerarSrt(clipesTeste(), { estiloLegenda: 'karaoke', legenda: { maxPalavras: 1 } });
  const blocos = srt.trim().split('\n\n');
  assert.equal(blocos.length, 4); // 3 palavras do c1 + 1 do c2
});

test('gerarSrt: maiusculas (override) aplica textTransform no texto exportado', () => {
  const srt = gerarSrt(clipesTeste(), { estiloLegenda: 'karaoke', legenda: { maiusculas: true } });
  assert.ok(srt.includes('É ASSIM QUE') || srt.includes('ASSIM'));
  assert.ok(!/[a-z]/.test(srt.split('\n\n')[0]));
});

test('gerarSrt: preset "sem-legenda" (modo nenhum) devolve string vazia', () => {
  const srt = gerarSrt(clipesTeste(), { estiloLegenda: 'sem-legenda' });
  assert.equal(srt, '');
});

test('gerarSrt: sem clipes ativos devolve string vazia', () => {
  assert.equal(gerarSrt([], { estiloLegenda: 'karaoke' }), '');
});

test('gerarAss: cabecalho com Script Info e Styles, karaoke \\k por palavra', () => {
  const ass = gerarAss(clipesTeste(), { estiloLegenda: 'hormozi', corDestaque: '#FFD700' });
  assert.match(ass, /\[Script Info\]/);
  assert.match(ass, /\[V4\+ Styles\]/);
  assert.match(ass, /\[Events\]/);
  assert.match(ass, /Style: Default,/);
  assert.match(ass, /Dialogue: 0,\d:\d{2}:\d{2}\.\d{2},\d:\d{2}:\d{2}\.\d{2},Default,,0,0,0,,/);
  assert.match(ass, /\{\\k\d+\}/);
});

test('gerarAss: uma Dialogue por bloco do motor', () => {
  const ass = gerarAss(clipesTeste(), { estiloLegenda: 'karaoke', legenda: { maxPalavras: 1 } });
  const dialogos = ass.split('\n').filter((l) => l.startsWith('Dialogue:'));
  assert.equal(dialogos.length, 4);
});

test('gerarAss: PlayResX/Y seguem o `saida` do projeto', () => {
  const ass = gerarAss(clipesTeste(), { estiloLegenda: 'karaoke' }, { largura: 720, altura: 1280 });
  assert.match(ass, /PlayResX: 720/);
  assert.match(ass, /PlayResY: 1280/);
});
