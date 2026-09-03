import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { TRANSICOES } from '../shared/efeitos.js';
import { LUTS } from '../shared/cor.js';

/**
 * Testa a interface num DOM de verdade (jsdom), sem navegador.
 *
 * Existe porque um erro em tempo de carga no app.js mata a página inteira em
 * silêncio — a timeline fica parada e nada na tela funciona. `node --check` não
 * pega isso: a sintaxe está válida, o que quebra é a execução.
 */

const aqui = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.join(aqui, '..', '..');
const PUBLICO = path.join(RAIZ, 'public');

/** Projeto de mentira com o mesmo formato do projeto.json real. */
function projetoFalso() {
  const clipe = (id, bloco, inicio, dur) => ({
    id, bloco,
    inicio, fim: inicio + dur, duracao: dur,
    origemInicio: inicio, origemFim: inicio + dur,
    texto: `fala do ${id}`,
    palavras: [{ inicio, fim: inicio + dur, texto: 'fala' }],
  });
  return {
    nome: 'Teste',
    origem: { arquivo: 'bruto.mov', duracao: 30, largura: 1080, altura: 1920 },
    saida: { largura: 1080, altura: 1920, fps: 30 },
    fase1: {
      status: 'aguardando-aprovacao',
      arquivo: 'fase1-corte.mp4',
      duracao: 9,
      clipes: [clipe('c1', 'HOOK', 0, 3), clipe('c2', 'DINAMICA', 3, 4), clipe('c3', 'CTA', 7, 2)],
      descartados: [],
      picos: new Array(200).fill(0.4),
    },
    estilo: {
      tipoEdicao: 'limpa', corDestaque: '#EE7533',
      estiloHeadline: 'caixa-branca', estiloLegenda: 'karaoke',
      elementos: { automacaoZoomIn: true },
      observacoes: '',
    },
    cor: null,
    fase2: { status: 'nao-iniciada' },
    conversa: [{ quem: 'edvid', tipo: 'texto', texto: 'oi', em: '2026-01-01T00:00:00Z' }],
  };
}

/** Sobe a página num DOM, com fetch e WebSocket falsos. */
async function montarPagina() {
  const html = fs.readFileSync(path.join(PUBLICO, 'index.html'), 'utf8');
  const erros = [];

  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    url: 'http://localhost:4820/',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  window.addEventListener('error', (e) => erros.push(e.message || String(e.error)));

  const projeto = projetoFalso();
  const pedidos = [];
  window.fetch = async (url, opcoes = {}) => {
    pedidos.push({ url: String(url), metodo: opcoes.method || 'GET', corpo: opcoes.body });
    const u = String(url);
    const metodo = opcoes.method || 'GET';
    const json = (v) => ({ ok: true, status: 200, json: async () => v, text: async () => JSON.stringify(v) });
    if (u.includes('/api/projetos')) return json([{ nome: 'Teste', statusFase1: 'aguardando-aprovacao', statusFase2: 'nao-iniciada', duracao: 9 }]);
    if (u.includes('/api/luts')) return json(LUTS);
    if (u.includes('/api/fila')) return json({ atual: null, fila: [], feitos: [] });
    // Espelha o merge raso do servidor de verdade (`p.estilo = {...p.estilo, ...body}`),
    // senão salvarEstilo() sobrescreve P.estilo com o corpo errado na volta.
    if (metodo === 'PUT' && u.includes('/estilo')) {
      const patch = JSON.parse(opcoes.body || '{}');
      projeto.estilo = { ...projeto.estilo, ...patch };
      return json(projeto.estilo);
    }
    if (metodo === 'PUT' && u.includes('/cor')) {
      const patch = JSON.parse(opcoes.body || '{}');
      const atual = projeto.cor || { lut: null, intensidade: 1, ajustes: {} };
      projeto.cor = {
        lut: 'lut' in patch ? patch.lut : atual.lut,
        intensidade: 'intensidade' in patch ? patch.intensidade : atual.intensidade,
        ajustes: { ...atual.ajustes, ...(patch.ajustes || {}) },
      };
      return json({ cor: projeto.cor, precisaRefazer: true });
    }
    if (metodo === 'PATCH' && u.includes('/clipe/')) {
      const id = decodeURIComponent(u.split('/clipe/')[1]);
      const patch = JSON.parse(opcoes.body || '{}');
      const c = projeto.fase1.clipes.find((x) => x.id === id);
      if (c) Object.assign(c, patch);
      return json(c || {});
    }
    if (u.includes('/api/projeto/')) return json(projeto);
    return json({ ok: true });
  };
  window.WebSocket = class { constructor() { this.readyState = 0; } send() {} close() {} };
  // jsdom não implementa mídia; o suficiente para a timeline não quebrar.
  Object.defineProperty(window.HTMLMediaElement.prototype, 'play', { value: () => Promise.resolve() });
  Object.defineProperty(window.HTMLMediaElement.prototype, 'pause', { value() { } });

  const presets = fs.readFileSync(path.join(RAIZ, 'src', 'shared', 'presets.js'), 'utf8');
  const legendaMotor = fs.readFileSync(path.join(RAIZ, 'src', 'shared', 'legenda-motor.js'), 'utf8');
  const efeitos = fs.readFileSync(path.join(RAIZ, 'src', 'shared', 'efeitos.js'), 'utf8');
  const corCompartilhado = fs.readFileSync(path.join(RAIZ, 'src', 'shared', 'cor.js'), 'utf8');
  const amostraLegenda = fs.readFileSync(path.join(PUBLICO, 'amostra-legenda.js'), 'utf8');
  const corPagina = fs.readFileSync(path.join(PUBLICO, 'cor.js'), 'utf8');
  const app = fs.readFileSync(path.join(PUBLICO, 'app.js'), 'utf8');

  // Junta os módulos num script só, trocando os imports pelo corpo deles.
  const semExportPresets = presets.replace(/^export /gm, '');
  const semExportLegendaMotor = legendaMotor.replace(/^export /gm, '');
  const semExportEfeitos = efeitos.replace(/^export /gm, '');
  const semExportCorCompartilhado = corCompartilhado.replace(/^export /gm, '');
  const semImportAmostra = amostraLegenda
    .replace(/^import\s*\{[\s\S]*?\}\s*from\s*'\/shared\/presets\.js';/m, '')
    .replace(/^import\s*\{[\s\S]*?\}\s*from\s*'\/shared\/legenda-motor\.js';/m, '')
    .replace(/^export /gm, '');
  // public/cor.js declara `$`/`$$` locais, do mesmo nome que app.js — sem
  // isolamento (module scope de verdade) os dois `const $` colidiriam no
  // mesmo eval. A IIFE isola tudo e só expõe as duas funções que app.js chama.
  const semImportCorPagina = corPagina
    .replace(/^import\s*\{[\s\S]*?\}\s*from\s*'\/shared\/cor\.js';/m, '')
    .replace(/^export /gm, '');
  const corPaginaEnvolta = `(function () {\n${semImportCorPagina}\n`
    + 'window.montarCor = montarCor; window.aplicarCor = aplicarCor;\n})();';
  const semImportApp = app
    .replace(/^import\s*\{[\s\S]*?\}\s*from\s*'\/shared\/presets\.js';/m, '')
    .replace(/^import\s*\{[\s\S]*?\}\s*from\s*'\/amostra-legenda\.js';/m, '')
    .replace(/^import\s*\{[\s\S]*?\}\s*from\s*'\/shared\/efeitos\.js';/m, '')
    .replace(/^import\s*\{[\s\S]*?\}\s*from\s*'\/cor\.js';/m, '');

  try {
    window.eval([
      semExportPresets, semExportLegendaMotor, semExportEfeitos, semExportCorCompartilhado,
      semImportAmostra, corPaginaEnvolta, semImportApp,
    ].join('\n'));
  } catch (e) {
    erros.push(`erro ao carregar o app.js: ${e.message}`);
  }

  // Deixa as promessas do carregamento resolverem.
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 5));
  // `fechar` é obrigatório: a animação dos presets roda num requestAnimationFrame
  // infinito e seguraria o processo de teste para sempre.
  return { window, doc: window.document, erros, pedidos, projeto, fechar: () => window.close() };
}

test('a página carrega sem estourar', async (t) => {
  const { erros, fechar } = await montarPagina();
  t.after(fechar);
  assert.deepEqual(erros, [], `a página quebrou ao carregar:\n  ${erros.join('\n  ')}`);
});

test('a timeline desenha um bloco por clipe, com rótulo e duração', async (t) => {
  const { doc, erros, fechar } = await montarPagina();
  t.after(fechar);
  assert.deepEqual(erros, []);
  const clipes = doc.querySelectorAll('#trilhaClipes .clipe');
  assert.equal(clipes.length, 3, 'esperava 3 clipes na timeline');
  assert.equal(clipes[0].querySelector('.tag').textContent, 'HOOK');
  assert.match(clipes[0].querySelector('.dur').textContent, /^3\.00s$/);
  assert.ok(doc.querySelectorAll('#trilhaOnda i').length > 10, 'waveform vazia');
  assert.ok(doc.querySelectorAll('#regua i').length > 1, 'régua vazia');
});

test('clicar num clipe seleciona e abre a ficha com os beats', async (t) => {
  const { doc, window, erros, fechar } = await montarPagina();
  t.after(fechar);
  assert.deepEqual(erros, []);
  const c2 = doc.querySelector('#trilhaClipes .clipe[data-id="c2"]');
  assert.ok(c2, 'clipe c2 não existe');
  c2.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 30));

  assert.notEqual(doc.querySelector('#fichaClipe').style.display, 'none', 'a ficha não abriu');
  assert.match(doc.querySelector('#clipeTexto').textContent, /fala do c2/);
  const beats = [...doc.querySelectorAll('#clipeBlocos button')].map((b) => b.textContent.trim());
  assert.ok(beats.includes('HOOK') && beats.includes('CTA'), `beats faltando: ${beats}`);
});

test('cada clipe tem as duas alças de aparar', async (t) => {
  const { doc, erros, fechar } = await montarPagina();
  t.after(fechar);
  assert.deepEqual(erros, []);
  const c1 = doc.querySelector('#trilhaClipes .clipe[data-id="c1"]');
  assert.ok(c1.querySelector('.alca.ini'), 'sem alça de início');
  assert.ok(c1.querySelector('.alca.fim'), 'sem alça de fim');
});

test('arrastar a alça manda o novo corte para o servidor', async (t) => {
  const { doc, window, erros, pedidos, fechar } = await montarPagina();
  t.after(fechar);
  assert.deepEqual(erros, []);
  const alca = doc.querySelector('#trilhaClipes .clipe[data-id="c1"] .alca.fim');
  const ev = (tipo, x, alvo = window) => alvo.dispatchEvent(
    new window.PointerEvent(tipo, { clientX: x, clientY: 10, bubbles: true, cancelable: true }),
  );
  ev('pointerdown', 300, alca);
  ev('pointermove', 260);
  ev('pointerup', 260);
  await new Promise((r) => setTimeout(r, 60));

  const patch = pedidos.find((p) => p.metodo === 'PATCH' && p.url.includes('/clipe/c1'));
  assert.ok(patch, `nenhum PATCH foi enviado. Pedidos: ${pedidos.map((p) => p.metodo + ' ' + p.url).join(', ')}`);
  const corpo = JSON.parse(patch.corpo);
  assert.ok('origemFim' in corpo, 'o PATCH não mandou origemFim');
  assert.ok(corpo.origemFim < 3, `origemFim devia ter encolhido, veio ${corpo.origemFim}`);
});

test('o botão de play e o de ajustar respondem', async (t) => {
  const { doc, window, erros, fechar } = await montarPagina();
  t.after(fechar);
  assert.deepEqual(erros, []);
  const larguraAntes = doc.querySelector('#pista').style.width;
  doc.querySelector('#btnAjustar').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 30));
  assert.notEqual(doc.querySelector('#pista').style.width, larguraAntes,
    'o botão de ajustar não mexeu no zoom');
});

test('a headline digitada é salva antes de renderizar', async (t) => {
  // Regressão real: o campo ficou sem handler e o texto do usuário era
  // descartado; e clicar em renderizar logo após digitar mandava o texto velho.
  const { doc, window, erros, pedidos, projeto, fechar } = await montarPagina();
  t.after(fechar);
  assert.deepEqual(erros, []);
  projeto.fase1.status = 'aprovada';

  const campo = doc.querySelector('#headline');
  assert.ok(campo, 'o campo da headline não existe');
  campo.value = 'Minha headline nova';
  campo.dispatchEvent(new window.Event('input', { bubbles: true }));

  // Clica em renderizar imediatamente, sem esperar o tempo do debounce.
  doc.querySelector('#btnFase2').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 120));

  const salvou = pedidos.find((p) => p.metodo === 'PUT' && p.url.includes('/fase2'));
  assert.ok(salvou, `a headline não foi salva. Pedidos: ${pedidos.map((p) => p.metodo + ' ' + p.url).join(', ')}`);
  assert.equal(JSON.parse(salvou.corpo).headline, 'Minha headline nova');

  const ordem = pedidos.map((p) => `${p.metodo} ${p.url}`);
  const iSalvou = ordem.findIndex((x) => x.includes('PUT') && x.includes('/fase2'));
  const iRender = ordem.findIndex((x) => x.includes('/api/fila/fase2'));
  assert.ok(iRender === -1 || iSalvou < iRender,
    'o render foi pedido antes de a headline ser salva');
});

test('a headline não é sobrescrita enquanto está sendo digitada', async (t) => {
  const { doc, window, erros, fechar } = await montarPagina();
  t.after(fechar);
  assert.deepEqual(erros, []);
  const campo = doc.querySelector('#headline');
  campo.focus();
  campo.value = 'digitando ainda';
  // Um redesenho (ex.: chegou atualização pelo WebSocket) não pode limpar isso.
  window.aplicarFase2?.();
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(campo.value, 'digitando ainda');
});

/* ---------------------------------------------------------- UI-1: estilo */

test('a aba Estilo mostra um card por transição e o clicado vira PUT /estilo com o tipo', async (t) => {
  const { doc, window, erros, pedidos, fechar } = await montarPagina();
  t.after(fechar);
  assert.deepEqual(erros, []);

  const cards = doc.querySelectorAll('#transicoesGrade .transPreset');
  assert.equal(cards.length, TRANSICOES.length, `esperava ${TRANSICOES.length} cards de transição`);

  const alvo = doc.querySelector('#transicoesGrade .transPreset[data-id="crossfade"]');
  assert.ok(alvo, 'card da transição crossfade não existe');
  alvo.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 30));

  const put = pedidos.find((p) => p.metodo === 'PUT' && p.url.includes('/estilo')
    && JSON.parse(p.corpo || '{}').transicao?.tipo === 'crossfade');
  assert.ok(put, `nenhum PUT /estilo com transicao crossfade. Pedidos: ${
    pedidos.map((p) => `${p.metodo} ${p.url}`).join(', ')}`);
});

test('ligar o grão e mover o range manda efeitos.grao entre 0 e 1', async (t) => {
  const { doc, window, erros, pedidos, fechar } = await montarPagina();
  t.after(fechar);
  assert.deepEqual(erros, []);

  const toggle = doc.querySelector('#efeitosGrade [data-toggle="grao"]');
  assert.ok(toggle, 'toggle do grão não existe');
  toggle.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 30));

  const range = doc.querySelector('#efeitosGrade input[data-range="grao"]');
  assert.ok(range, 'range do grão não existe');
  assert.equal(range.disabled, false, 'o range devia ligar junto com o toggle');
  range.value = '80';
  range.dispatchEvent(new window.Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 350)); // debounce de 300 ms do range

  const puts = pedidos
    .filter((p) => p.metodo === 'PUT' && p.url.includes('/estilo'))
    .map((p) => JSON.parse(p.corpo || '{}'))
    .filter((b) => typeof b.efeitos?.grao === 'number');
  assert.ok(puts.length > 0, 'nenhum PUT /estilo mandou efeitos.grao');
  const ultimo = puts.at(-1).efeitos.grao;
  assert.ok(ultimo >= 0 && ultimo <= 1, `efeitos.grao fora da faixa 0..1: ${ultimo}`);
});

test('a aba Cor monta os cards de LUT e o clicado vira PUT /cor com o lut', async (t) => {
  const { doc, window, erros, pedidos, fechar } = await montarPagina();
  t.after(fechar);
  assert.deepEqual(erros, []);
  // montarCor() busca /api/luts de forma assíncrona — dá tempo de a resposta chegar.
  await new Promise((r) => setTimeout(r, 30));

  const cards = doc.querySelectorAll('#lutGrade .lutCard');
  assert.equal(cards.length, LUTS.length + 1, `esperava ${LUTS.length + 1} cards (LUTs + "Nenhuma")`);

  const alvo = doc.querySelector(`#lutGrade .lutCard[data-id="${LUTS[0].id}"]`);
  assert.ok(alvo, 'card da primeira LUT não existe');
  alvo.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 350)); // debounce de 300 ms do PUT /cor

  const put = pedidos.find((p) => p.metodo === 'PUT' && p.url.includes('/cor')
    && JSON.parse(p.corpo || '{}').lut === LUTS[0].id);
  assert.ok(put, `nenhum PUT /cor com o lut. Pedidos: ${
    pedidos.map((p) => `${p.metodo} ${p.url}`).join(', ')}`);
});

test('a timeline desenha n-1 marcadores de transição para n clipes', async (t) => {
  const { doc, erros, fechar } = await montarPagina();
  t.after(fechar);
  assert.deepEqual(erros, []);
  const marcadores = doc.querySelectorAll('#trilhaClipes .marcaTransicao');
  assert.equal(marcadores.length, 2, 'esperava 2 marcadores para 3 clipes');
});
