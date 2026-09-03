import assert from 'node:assert/strict';
import test from 'node:test';
import {
  agruparEmFalas, marcarDescartes, classificarBlocos, corteOrganico, marcarDestaques,
  fundirCTA,
} from './corte.js';

/** Helper: monta palavras a partir de "texto@inicio-fim". */
const p = (texto, inicio, fim) => ({ texto, inicio, fim });

test('agrupa em falas quebrando por pausa e por fim de frase', () => {
  const falas = agruparEmFalas([
    p('Oi', 0, 0.3), p('gente.', 0.3, 0.8),
    p('Hoje', 0.9, 1.2), p('eu', 1.2, 1.35), p('vou', 1.35, 1.6),
    p('contar', 3.0, 3.5),
  ]);
  assert.equal(falas.length, 3);
  assert.equal(falas[0].texto, 'Oi gente.');
  assert.equal(falas[2].texto, 'contar');
});

test('descarta respiro solto e muleta', () => {
  const falas = marcarDescartes(agruparEmFalas([
    p('Ah', 0, 0.15),
    p('Entao', 1.0, 1.4), p('gente,', 1.4, 1.9),
  ]));
  assert.equal(falas[0].descartar, true);
  assert.ok(falas[0].motivos.includes('respiro'));
  assert.equal(falas[1].descartar, false);
});

test('descarta falso comeco quando a fala seguinte engloba a anterior', () => {
  const falas = marcarDescartes(agruparEmFalas([
    p('O', 0, 0.2), p('segredo', 0.2, 0.8), p('e.', 0.8, 1.0),
    p('O', 2.0, 2.2), p('segredo', 2.2, 2.8), p('e', 2.8, 3.0),
    p('acordar', 3.0, 3.5), p('cedo', 3.5, 4.0), p('todo', 4.0, 4.3), p('dia.', 4.3, 4.7),
  ]));
  assert.equal(falas[0].descartar, true);
  assert.ok(falas[0].motivos.some((m) => m === 'false-start' || m === 'tomada-refeita'));
  assert.equal(falas.at(-1).descartar, false);
});

test('descarta tomada repetida identica', () => {
  const falas = marcarDescartes(agruparEmFalas([
    p('Isso', 0, 0.4), p('muda', 0.4, 0.8), p('tudo.', 0.8, 1.2),
    p('Isso', 3.0, 3.4), p('muda', 3.4, 3.8), p('tudo.', 3.8, 4.2),
  ]));
  assert.equal(falas[0].descartar, true);
  assert.equal(falas[1].descartar, false);
});

test('blocos nunca voltam atras', () => {
  const clipes = classificarBlocos([
    { duracao: 2, texto: 'Olha isso aqui' },
    { duracao: 2, texto: 'entao funciona assim' },
    { duracao: 2, texto: 'clica no link na bio' },
    { duracao: 2, texto: 'e tambem serve pra outra coisa' },
    { duracao: 2, texto: 'comenta aqui embaixo' },
  ]);
  const ordem = ['HOOK', 'DINAMICA', 'RECURSOS', 'CTA'];
  const idx = clipes.map((c) => ordem.indexOf(c.bloco));
  assert.deepEqual(idx, [...idx].sort((a, b) => a - b), `blocos fora de ordem: ${idx}`);
  assert.equal(clipes[0].bloco, 'HOOK');
  assert.equal(clipes.at(-1).bloco, 'CTA');
});

test('pipeline completo remove o descarte da linha do tempo', () => {
  const palavras = [
    p('Ah', 0, 0.12),
    p('O', 1.0, 1.2), p('setup', 1.2, 1.8), p('e.', 1.8, 2.0),
    p('O', 3.0, 3.2), p('setup', 3.2, 3.8), p('e', 3.8, 4.0),
    p('esse', 4.0, 4.4), p('aqui', 4.4, 4.8), p('mesmo.', 4.8, 5.3),
    p('Comenta', 7.0, 7.6), p('aqui', 7.6, 8.0), p('embaixo.', 8.0, 8.6),
  ];
  const r = corteOrganico(palavras, 9);
  const textos = r.clipes.map((c) => c.texto).join(' | ');
  assert.ok(!/^Ah/.test(textos), 'o respiro inicial deveria ter sumido');
  assert.ok(r.descartados.length >= 1);
  assert.ok(r.clipes.every((c) => c.duracao > 0));
  // Nenhum clipe pode invadir o vizinho.
  for (let i = 1; i < r.clipes.length; i++) {
    assert.ok(r.clipes[i].origemInicio >= r.clipes[i - 1].origemFim,
      `clipe ${i} comeca antes do fim do anterior`);
  }
});

test('corta pelo silencio real quando o Whisper nao devolve pontuacao', () => {
  // Como o whisper.cpp realmente emite: palavras coladas, fim de uma = inicio
  // da outra, e sem ponto nenhum. Foi o que deixou um video de 42s num clipe so.
  const palavras = [];
  let t = 0;
  for (const w of ['Toda', 'vez', 'que', 'voce', 'fala', 'que', 'nao', 'tem', 'gente',
    'as', 'coisas', 'nao', 'acontecem', 'no', 'seu', 'negocio']) {
    palavras.push(p(w, t, t + 0.4));
    t += 0.4;
  }
  // Dois silencios de verdade no audio, que o Whisper nao reportou.
  const silencios = [{ inicio: 3.6, fim: 4.2 }, { inicio: 5.2, fim: 5.9 }];

  const semSilencio = agruparEmFalas(palavras, { silencios: [] });
  const comSilencio = agruparEmFalas(palavras, { silencios });

  assert.ok(comSilencio.length > semSilencio.length,
    `o silencio deveria gerar mais falas (${comSilencio.length} vs ${semSilencio.length})`);
  assert.ok(comSilencio.length >= 3, `esperava 3+ falas, veio ${comSilencio.length}`);
});

test('marcarDestaques marca numero/R$, verbo de promessa, negacao forte, caixa alta e nome proprio', () => {
  const palavras = [
    p('Você', 0, 0.2), p('vai', 0.2, 0.4), p('faturar', 0.4, 0.8), p('R$', 0.8, 1.0),
    p('10', 1.0, 1.2), p('mil', 1.2, 1.4), p('e', 1.4, 1.5), p('nunca', 1.5, 1.8),
    p('mais', 1.8, 2.0), p('vai', 2.0, 2.2), p('parar.', 2.2, 2.6),
    p('É', 2.7, 2.8), p('SÉRIO', 2.8, 3.2), p('mesmo,', 3.2, 3.6),
    p('pergunta', 3.7, 4.1), p('pro', 4.1, 4.3), p('Mateus', 4.3, 4.7), p('ali.', 4.7, 5.0),
  ];
  const marcadas = marcarDestaques(palavras);
  assert.ok(marcadas.every((m) => 'destaque' in m), 'toda palavra sai com o campo destaque');

  const destacada = (texto) => marcadas.find((m) => m.texto === texto)?.destaque;
  assert.equal(destacada('faturar'), true, 'verbo de promessa deveria ser destaque');
  assert.equal(destacada('R$'), true, 'R$ deveria ser destaque');
  assert.equal(destacada('nunca'), true, 'negação forte deveria ser destaque');
  assert.equal(destacada('SÉRIO'), true, 'caixa alta deveria ser destaque');
  assert.equal(destacada('Mateus'), true, 'nome próprio deveria ser destaque');
});

test('marcarDestaques marca no máximo 2 por bloco de ~4 palavras', () => {
  // Cinco candidatos seguidos (todos caixa alta) num bloco de 4 — so 2 saem marcados.
  const palavras = ['UM', 'DOIS', 'TRES', 'QUATRO'].map((t, i) => p(t, i, i + 0.5));
  const marcadas = marcarDestaques(palavras);
  assert.equal(marcadas.filter((m) => m.destaque).length, 2);
});

test('marcarDestaques não marca maiúscula de início de frase como nome próprio', () => {
  const palavras = [p('Hoje', 0, 0.3), p('vai', 0.3, 0.5), p('chover', 0.5, 0.9), p('aqui.', 0.9, 1.2)];
  const marcadas = marcarDestaques(palavras);
  assert.equal(marcadas.find((m) => m.texto === 'Hoje').destaque, false);
});

test('corteOrganico já sai com palavras[].destaque marcado', () => {
  const palavras = [
    p('Você', 0, 0.3), p('vai', 0.3, 0.6), p('faturar', 0.6, 1.0), p('muito.', 1.0, 1.4),
  ];
  const r = corteOrganico(palavras, 2);
  const todasAsPalavras = r.clipes.flatMap((c) => c.palavras);
  assert.ok(todasAsPalavras.length > 0);
  assert.ok(todasAsPalavras.every((w) => typeof w.destaque === 'boolean'));
  assert.ok(todasAsPalavras.some((w) => w.destaque === true), 'faturar deveria sair marcado');
});

test('fala longa sem pontuacao nem silencio ainda assim e quebrada', () => {
  const palavras = [];
  for (let i = 0; i < 60; i++) palavras.push(p(`w${i}`, i * 0.4, i * 0.4 + 0.4));
  const falas = agruparEmFalas(palavras, { silencios: [] });
  assert.ok(falas.length >= 3, `24s num clipe so: veio ${falas.length} fala(s)`);
  assert.ok(falas.every((f) => f.fim - f.inicio <= 7.5),
    'nenhuma fala pode passar da trava de 7s');
});

// --- H4: corte organico nao pode picar frase boa em fragmento de <1s ---

test('H4 (a): caso real da VPS - nao pica "existem tres erros que travam..." e funde o CTA num clipe so', () => {
  // Palavras/tempos aproximados do caso medido em 02/09 (projeto palestra-teste,
  // 22,8s). Gaps de 0,2 a 0,35s entre falas do mesmo periodo, como uma pausa de
  // respiracao curta do TTS/whisper — e exatamente o que picava antes do H4.
  let t = 0;
  const falar = (palavras, gapDepois = 0) => {
    for (const w of palavras) { p2.push(p(w, t, t + 0.3)); t += 0.3; }
    t += gapDepois;
  };
  const p2 = [];

  falar(['Se', 'voce', 'e', 'dono', 'de', 'empresa', 'e', 'sente', 'que', 'trabalha',
    'demais', 'e', 'cresce', 'de', 'menos,'], 0.25);
  falar(['presta', 'atencao', 'nisso.'], 0.6);
  // A frase que picava: "Existem tres erros que" | "travam o faturamento..."
  falar(['Existem', 'tres', 'erros', 'que'], 0.25);
  falar(['travam', 'o', 'faturamento', 'de', 'quase', 'toda', 'empresa', 'pequena.'], 0.6);
  falar(['O', 'primeiro', 'e', 'nao', 'ter', 'processo.'], 0.6);
  falar(['O', 'segundo', 'e', 'depender', 'so', 'de', 'voce.'], 0.6);
  falar(['O', 'terceiro', 'e', 'nao', 'medir', 'nada.'], 0.6);
  // O CTA que virava quatro cortes secos de 0,6 a 1,2s.
  falar(['Comenta', 'aqui'], 0.25);
  falar(['qual', 'desses'], 0.2);
  falar(['tres', 'e', 'o', 'seu,', 'que'], 0.3);
  falar(['eu', 'te', 'respondo.']);

  const r = corteOrganico(p2, t + 0.3);

  const dinamica = r.clipes.find((c) => c.texto.includes('Existem tres erros'));
  assert.ok(dinamica, 'clipe com "Existem tres erros" deveria existir');
  assert.equal(dinamica.texto, 'Existem tres erros que travam o faturamento de quase toda empresa pequena.',
    'a frase nao pode ficar picada em dois clipes');

  const ctas = r.clipes.filter((c) => c.bloco === 'CTA');
  assert.equal(ctas.length, 1, `CTA deveria virar um clipe so, veio ${ctas.length}`);
  assert.equal(ctas[0].texto, 'Comenta aqui qual desses tres e o seu, que eu te respondo.');
  assert.ok(ctas[0].duracao <= 7, 'CTA fundido nao pode passar de maxFala');
});

test('H4 (b): fragmento isolado por gap grande dos dois lados continua clipe proprio', () => {
  const palavras = [
    p('Tudo', 0, 0.4), p('bem', 0.4, 0.9), p('ate', 0.9, 1.1), p('aqui.', 1.1, 1.5),
    // "Isso." isolado por 1,5s de silencio antes e depois — maior que gapFusaoS (0,35s).
    p('Isso.', 3.0, 3.5),
    p('Mas', 5.0, 5.3), p('depois', 5.3, 5.7), p('muda', 5.7, 6.1), p('tudo.', 6.1, 6.6),
  ];
  const r = corteOrganico(palavras, 7);
  const isolado = r.clipes.find((c) => c.texto === 'Isso.');
  assert.ok(isolado, 'o fragmento "Isso." deveria continuar como clipe proprio');
});

test('H4 (c): fala longa continua ainda quebra em 7s mesmo depois da fusao de clipe curto', () => {
  const palavras = [];
  for (let i = 0; i < 60; i++) palavras.push(p(`w${i}`, i * 0.4, i * 0.4 + 0.4));
  const r = corteOrganico(palavras, 25);
  assert.ok(r.clipes.length >= 3, `24s num clipe so: veio ${r.clipes.length} clipe(s)`);
  assert.ok(r.clipes.every((c) => c.duracao <= 7.5),
    'nenhum clipe pode passar da trava de 7s, nem depois da fusao');
});

test('H4 (d): fala terminando em conector ("que") nao fecha, mesmo com pausa real depois', () => {
  const silencios = [{ inicio: 1.2, fim: 1.5 }];
  const palavras = [
    p('Existem', 0, 0.3), p('tres', 0.3, 0.6), p('erros', 0.6, 0.9), p('que', 0.9, 1.2),
    p('travam', 1.5, 1.8), p('o', 1.8, 1.9), p('faturamento.', 1.9, 2.4),
  ];
  const falas = agruparEmFalas(palavras, { silencios });
  assert.equal(falas.length, 1, 'nao deveria quebrar depois de "que"');
  assert.equal(falas[0].texto, 'Existem tres erros que travam o faturamento.');
});

test('H4: fundirCTA nao funde se a soma passar de maxFala', () => {
  const clipes = [
    { inicio: 0, fim: 6, duracao: 6, texto: 'primeiro cta bem longo', bloco: 'CTA', palavras: [] },
    { inicio: 6.1, fim: 8, duracao: 1.9, texto: 'segundo pedaco', bloco: 'CTA', palavras: [] },
  ];
  const fundidos = fundirCTA(clipes);
  assert.equal(fundidos.length, 2, 'soma > 7s: nao deveria fundir');
});
