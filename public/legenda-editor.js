/*
 * Painel "Legenda" da Fase 1 (UI-2): as palavras do clipe selecionado como
 * chips — clicar leva a agulha, duplo clique edita o texto, botão direito ou
 * "⋯" abre o menu (destacar, ocultar, dividir, juntar, empurrar). Módulo
 * separado de app.js, mesmo padrão de `cor.js`: só ele mexe nos ids do
 * painel; `montarLegendaEditor()` uma vez, `aplicarLegendaEditor(projeto,
 * clipeId)` toda vez que o projeto ou a seleção mudam, `aoTempoLegendaEditor(t)`
 * a cada `ontimeupdate` da timeline da Fase 1 (acende o chip da palavra que
 * está soando).
 */

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

/* ---------------------------------------------------------------- estado */
let nomeProjeto = null;
let clipeAtual = null;   // clipe inteiro (com .palavras) do fase1.clipes, ou null
let fase1Status = null;
let aberto = true;       // colapsável — aberto por padrão enquanto há clipes
let popover = null;      // menu ou "dividir aqui" aberto no momento, ou null
let moverAgulhaFn = () => {};
let recarregarFn = () => {};

const escapeHtml = (t = '') => String(t)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* ---------------------------------------------------------------- montar */
export function montarLegendaEditor({ moverAgulha, recarregar } = {}) {
  moverAgulhaFn = moverAgulha || (() => {});
  recarregarFn = recarregar || (() => {});

  $('#legEditorToggle').onclick = () => { aberto = !aberto; refletirAberto(); };

  const chips = $('#legChips');
  chips.addEventListener('click', (e) => {
    const menuBtn = e.target.closest('.legChipMenu');
    const chip = e.target.closest('.legChip');
    if (!chip) return;
    if (menuBtn) { abrirMenu(chip); return; }
    if (chip.classList.contains('editando')) return;
    const w = clipeAtual?.palavras?.[Number(chip.dataset.i)];
    if (w) moverAgulhaFn(w.inicio);
  });
  chips.addEventListener('dblclick', (e) => {
    const chip = e.target.closest('.legChip');
    if (chip) iniciarEdicao(chip);
  });
  chips.addEventListener('contextmenu', (e) => {
    const chip = e.target.closest('.legChip');
    if (!chip) return;
    e.preventDefault();
    abrirMenu(chip);
  });
  chips.addEventListener('keydown', (e) => {
    const chip = e.target.closest('.legChip');
    if (!chip || chip.classList.contains('editando')) return;
    const i = Number(chip.dataset.i);
    const tecla = e.key.toLowerCase();
    if (tecla === 'd') { e.preventDefault(); alternarDestaque(i); } else if (tecla === 'o') {
      e.preventDefault(); alternarOculta(i);
    } else if (tecla === 'j') { e.preventDefault(); juntar(i); } else if (e.key === '[') {
      e.preventDefault(); empurrar(i, -0.05, false);
    } else if (e.key === ']') { e.preventDefault(); empurrar(i, 0.05, false); }
  });

  // Clicar fora fecha o menu/popover de "dividir aqui" aberto.
  document.addEventListener('click', (e) => {
    if (popover && !popover.contains(e.target) && !e.target.closest('.legChipMenu')) fecharPopover();
  });
}

/* --------------------------------------------------------------- aplicar */
export function aplicarLegendaEditor(projeto, clipeId) {
  nomeProjeto = projeto?.nome || null;
  fase1Status = projeto?.fase1?.status || null;
  const clipes = projeto?.fase1?.clipes || [];
  clipeAtual = clipes.find((c) => c.id === clipeId) || null;

  const painel = $('#legendaEditor');
  if (!painel) return;
  if (!clipes.length) { painel.style.display = 'none'; return; }
  painel.style.display = '';

  $('#legAvisoAprovada').style.display = fase1Status === 'aprovada' ? '' : 'none';

  if (nomeProjeto) {
    $('#legBaixarSrt').href = `/api/projeto/${encodeURIComponent(nomeProjeto)}/legenda.srt`;
    $('#legBaixarAss').href = `/api/projeto/${encodeURIComponent(nomeProjeto)}/legenda.ass`;
  }

  desenharChips();
  refletirAberto();
}

/** Hook de tempo: chame a cada `ontimeupdate` do player da Fase 1 (o tempo já
 * está em segundos do corte, o mesmo tempo de `palavras[].inicio/fim`). */
export function aoTempoLegendaEditor(t) {
  if (!clipeAtual) return;
  $$('#legChips .legChip').forEach((el) => {
    const w = clipeAtual.palavras[Number(el.dataset.i)];
    el.classList.toggle('ativa', !!(w && t >= w.inicio && t < w.fim));
  });
}

/* ---------------------------------------------------------------- desenho */
function refletirAberto() {
  $('#legendaEditor')?.classList.toggle('colapsado', !aberto);
  $('#legEditorToggle')?.classList.toggle('aberto', aberto);
}

function desenharChips() {
  const palavras = clipeAtual?.palavras || [];
  $('#legVazio').style.display = clipeAtual ? 'none' : '';
  $('#legChips').style.display = clipeAtual ? '' : 'none';

  const destaques = palavras.filter((w) => w.destaque).length;
  $('#legContagem').textContent = clipeAtual
    ? `${palavras.length} palavra${palavras.length === 1 ? '' : 's'} · ${destaques} em destaque` : '';

  $('#legChips').innerHTML = palavras.map((w, i) => `
    <span class="legChip${w.destaque ? ' destaque' : ''}${w.oculta ? ' oculta' : ''}"
          data-i="${i}" tabindex="0">
      <span class="legChipTexto">${escapeHtml(w.texto)}</span>
      <button class="legChipMenu" type="button" tabindex="-1" title="Mais ações">&#8943;</button>
    </span>`).join('');
}

/* ----------------------------------------------------------- edição inline */
function iniciarEdicao(chip) {
  if (chip.classList.contains('editando')) return;
  fecharPopover();
  const i = Number(chip.dataset.i);
  const w = clipeAtual?.palavras?.[i];
  if (!w) return;
  chip.classList.add('editando');
  const textoEl = chip.querySelector('.legChipTexto');
  const original = w.texto;
  textoEl.innerHTML = `<input type="text" class="legChipInput" value="${escapeHtml(original)}">`;
  const input = textoEl.querySelector('input');
  input.focus();
  input.select();

  let saiu = false;
  const sair = async (salvar) => {
    if (saiu) return;
    saiu = true;
    const novo = input.value.trim();
    if (salvar && novo && novo !== original) {
      await patchPalavra(clipeAtual.id, i, { texto: novo });
      recarregarFn();
    } else {
      chip.classList.remove('editando');
      textoEl.textContent = original;
    }
  };
  input.onkeydown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); sair(true); } else if (e.key === 'Escape') {
      e.preventDefault(); sair(false);
    }
  };
  input.onblur = () => sair(true);
}

/* --------------------------------------------------------------- menu "⋯" */
function fecharPopover() { popover?.remove(); popover = null; }

function posicionarPopover(pop, chip) {
  document.body.appendChild(pop);
  const r = chip.getBoundingClientRect();
  pop.style.left = `${Math.max(4, r.left)}px`;
  pop.style.top = `${r.bottom + 6}px`;
  popover = pop;
}

function abrirMenu(chip) {
  fecharPopover();
  const i = Number(chip.dataset.i);
  const w = clipeAtual?.palavras?.[i];
  if (!w) return;

  const pop = document.createElement('div');
  pop.className = 'legMenu';
  pop.innerHTML = `
    <button data-a="destaque">${w.destaque ? 'Tirar destaque' : 'Destacar'}</button>
    <button data-a="oculta">${w.oculta ? 'Mostrar' : 'Ocultar'}</button>
    <button data-a="dividir">Dividir aqui…</button>
    <button data-a="juntar">Juntar com a próxima</button>
    <button data-a="empurrar-mais">Empurrar +0,1s (só esta)</button>
    <button data-a="empurrar-menos">Empurrar −0,1s (só esta)</button>
    <button data-a="empurrar-fim-mais">Empurrar daqui até o fim +0,1s</button>
    <button data-a="empurrar-fim-menos">Empurrar daqui até o fim −0,1s</button>`;

  pop.querySelectorAll('button').forEach((b) => {
    b.onclick = async (e) => {
      e.stopPropagation();
      const a = b.dataset.a;
      if (a === 'dividir') { fecharPopover(); abrirDividir(chip, i, w); return; }
      if (a === 'destaque') await alternarDestaque(i);
      else if (a === 'oculta') await alternarOculta(i);
      else if (a === 'juntar') await juntar(i);
      else if (a === 'empurrar-mais') await empurrar(i, 0.1, false);
      else if (a === 'empurrar-menos') await empurrar(i, -0.1, false);
      else if (a === 'empurrar-fim-mais') await empurrar(i, 0.1, true);
      else if (a === 'empurrar-fim-menos') await empurrar(i, -0.1, true);
      fecharPopover();
    };
  });
  posicionarPopover(pop, chip);
}

/** "Dividir aqui": o input mostra o texto da palavra, o corte usa a posição
 * do cursor (`selectionStart`) — o mesmo índice que `POST .../palavras/dividir`
 * espera em `posicao`. */
function abrirDividir(chip, i, w) {
  const pop = document.createElement('div');
  pop.className = 'legMenu legDividir';
  pop.innerHTML = `
    <div class="legDividirTexto">Posicione o cursor onde cortar e confirme:</div>
    <input type="text" class="legDividirInput" value="${escapeHtml(w.texto)}">
    <div class="legDividirAcoes">
      <button data-a="ok" type="button">Dividir</button>
      <button data-a="cancelar" type="button">Cancelar</button>
    </div>`;
  posicionarPopover(pop, chip);
  const input = pop.querySelector('.legDividirInput');
  input.focus();

  const confirmar = async () => {
    const posicao = input.selectionStart;
    fecharPopover();
    if (posicao > 0 && posicao < w.texto.length) {
      await dividirPalavraReq(clipeAtual.id, i, posicao);
      recarregarFn();
    }
  };
  pop.querySelector('[data-a="ok"]').onclick = confirmar;
  pop.querySelector('[data-a="cancelar"]').onclick = () => fecharPopover();
  input.onkeydown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); confirmar(); } else if (e.key === 'Escape') {
      e.preventDefault(); fecharPopover();
    }
  };
}

/* ------------------------------------------------------------------ ações */
async function alternarDestaque(i) {
  const w = clipeAtual.palavras[i];
  await patchPalavra(clipeAtual.id, i, { destaque: !w.destaque });
  recarregarFn();
}
async function alternarOculta(i) {
  const w = clipeAtual.palavras[i];
  await patchPalavra(clipeAtual.id, i, { oculta: !w.oculta });
  recarregarFn();
}
async function juntar(i) {
  await juntarPalavraReq(clipeAtual.id, i);
  recarregarFn();
}
async function empurrar(i, deltaS, ateOFim) {
  await empurrarPalavraReq(clipeAtual.id, i, deltaS, ateOFim);
  recarregarFn();
}

/* ------------------------------------------------------------------- rede */
function patchPalavra(clipe, indice, corpo) {
  return fetch(`/api/projeto/${encodeURIComponent(nomeProjeto)}/palavras`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clipe, indice, ...corpo }),
  });
}
function dividirPalavraReq(clipe, indice, posicao) {
  return fetch(`/api/projeto/${encodeURIComponent(nomeProjeto)}/palavras/dividir`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clipe, indice, posicao }),
  });
}
function juntarPalavraReq(clipe, indice) {
  return fetch(`/api/projeto/${encodeURIComponent(nomeProjeto)}/palavras/juntar`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clipe, indice }),
  });
}
function empurrarPalavraReq(clipe, indice, deltaS, ateOFim) {
  return fetch(`/api/projeto/${encodeURIComponent(nomeProjeto)}/palavras/empurrar`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clipe, indice, deltaS, ateOFim: !!ateOFim }),
  });
}
