import { FAIXAS_AJUSTES, AJUSTES_PADRAO } from '/shared/cor.js';

/*
 * Aba Cor (F2): LUT + ajustes manuais, com antes/depois. Modulo separado de
 * app.js — so ele mexe nos ids de #aba-cor. `montarCor()` monta a grade de
 * LUTs e os sliders de ajuste uma vez; `aplicarCor(projeto)` roda toda vez
 * que um projeto abre ou e atualizado (mesmo padrao de aplicarEstilo/
 * aplicarFase2 em app.js).
 */

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const CHAVES_AJUSTE = Object.keys(FAIXAS_AJUSTES);

/** Formata o valor de um ajuste para o rótulo ao lado do slider. */
function formatarAjuste(chave, valor) {
  if (chave === 'temperatura' || chave === 'tint') return String(Math.round(valor));
  return valor.toFixed(2);
}

const fmtSeg = (s) => {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};

/* ---------------------------------------------------------------- estado */
let nomeProjeto = null;
let duracaoOrigem = 0;
let corAtual = { lut: null, intensidade: 1, ajustes: { ...AJUSTES_PADRAO } };
let precisaRefazer = false;
let tempoPreview = 0;
let versaoDepois = 0;

let tPut = null;
let pendentePut = {};
let tImg = null;
let tSlider = null;

function corPadraoLocal() {
  return { lut: null, intensidade: 1, ajustes: { ...AJUSTES_PADRAO } };
}

/* ---------------------------------------------------------------- montar */
export async function montarCor() {
  const grade = $('#lutGrade');
  const cardLut = (l) => `
    <div class="card lutCard" data-id="${l.id ?? ''}">
      <span class="marcaSel">✓</span>
      <div class="nome">${l.nome}</div>
      <div class="descLut">${l.descricao || ''}</div>
    </div>`;
  // As LUTs vem do servidor (GET /api/luts, mesmo catálogo de src/shared/cor.js)
  // em vez de import direto — o card mostra exatamente o que o servidor aplica.
  const r = await fetch('/api/luts');
  const luts = r.ok ? await r.json() : [];
  grade.innerHTML = [{ id: '', nome: 'Nenhuma', descricao: 'Sem LUT aplicada.' }, ...luts]
    .map(cardLut).join('');
  grade.onclick = (e) => {
    const el = e.target.closest('.lutCard');
    if (!el) return;
    agendarSalvar({ lut: el.dataset.id || null });
  };
  refletirEstado();

  $('#ajustesCor').innerHTML = CHAVES_AJUSTE.map((k) => {
    const f = FAIXAS_AJUSTES[k];
    const passo = ((f.max - f.min) / 100).toFixed(4);
    return `<div class="ajusteLinha" data-k="${k}">
      <span class="rotuloAjuste">${f.label}</span>
      <input type="range" min="${f.min}" max="${f.max}" step="${passo}" value="${AJUSTES_PADRAO[k]}">
      <span class="valorAjuste">${formatarAjuste(k, AJUSTES_PADRAO[k])}</span>
    </div>`;
  }).join('');

  $$('#ajustesCor .ajusteLinha input[type=range]').forEach((inp) => {
    inp.oninput = () => {
      const linha = inp.closest('.ajusteLinha');
      const k = linha.dataset.k;
      const v = Number(inp.value);
      linha.querySelector('.valorAjuste').textContent = formatarAjuste(k, v);
      agendarSalvar({ ajustes: { [k]: v } });
    };
  });

  $('#btnZerarCor').onclick = (e) => {
    e.preventDefault();
    agendarSalvar({ ajustes: { ...AJUSTES_PADRAO } });
  };

  $('#sliderTempoCor').oninput = (e) => {
    tempoPreview = Number(e.target.value);
    $('#tempoCorTexto').textContent = fmtSeg(tempoPreview);
    clearTimeout(tSlider);
    tSlider = setTimeout(() => atualizarPreview(), 500);
  };
  $('#btnAtualizarPreview').onclick = () => atualizarPreview();

  $('#btnRefazerCorte').onclick = async () => {
    if (!nomeProjeto) return;
    await fetch('/api/fila/refazer', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nome: nomeProjeto }),
    });
    precisaRefazer = false;
    atualizarFaixaAviso();
  };
}

/* ---------------------------------------------------------------- aplicar */
export function aplicarCor(projeto) {
  const trocouProjeto = projeto?.nome !== nomeProjeto;
  nomeProjeto = projeto?.nome || null;
  duracaoOrigem = projeto?.origem?.duracao || 0;
  corAtual = projeto?.cor ? {
    lut: projeto.cor.lut ?? null,
    intensidade: projeto.cor.intensidade ?? 1,
    ajustes: { ...AJUSTES_PADRAO, ...(projeto.cor.ajustes || {}) },
  } : corPadraoLocal();
  if (trocouProjeto) {
    precisaRefazer = false;
    tempoPreview = Math.min(duracaoOrigem, tempoPreview);
  }

  const slider = $('#sliderTempoCor');
  slider.max = String(Math.max(0.01, duracaoOrigem));
  if (Number(slider.value) > duracaoOrigem) slider.value = String(duracaoOrigem / 2);
  tempoPreview = Number(slider.value);
  $('#tempoCorTexto').textContent = fmtSeg(tempoPreview);

  refletirEstado();
  atualizarFaixaAviso();
  atualizarPreview();
}

function refletirEstado() {
  $$('#lutGrade .lutCard').forEach((el) => {
    el.classList.toggle('on', (el.dataset.id || null) === (corAtual.lut || null));
  });
  $$('#ajustesCor .ajusteLinha').forEach((linha) => {
    const k = linha.dataset.k;
    const range = linha.querySelector('input[type=range]');
    const v = corAtual.ajustes[k] ?? AJUSTES_PADRAO[k];
    if (document.activeElement !== range) range.value = String(v);
    linha.querySelector('.valorAjuste').textContent = formatarAjuste(k, v);
  });
}

function atualizarFaixaAviso() {
  $('#faixaAvisoCor').style.display = precisaRefazer ? '' : 'none';
}

/* --------------------------------------------------------------- preview */
function urlPreview(aplicar) {
  const t = tempoPreview.toFixed(2);
  const v = aplicar ? `&v=${versaoDepois}` : '';
  return `/api/projeto/${encodeURIComponent(nomeProjeto)}/cor/preview?t=${t}&aplicar=${aplicar ? 1 : 0}${v}`;
}

function atualizarPreview() {
  if (!nomeProjeto) return;
  $('#imgAntes').src = urlPreview(0);
  $('#imgDepois').src = urlPreview(1);
}

/* ------------------------------------------------------------------ salvar */
function mesclarPatch(atual, patch) {
  const novo = { ...atual };
  if (Object.prototype.hasOwnProperty.call(patch, 'lut')) novo.lut = patch.lut;
  if (Object.prototype.hasOwnProperty.call(patch, 'intensidade')) novo.intensidade = patch.intensidade;
  if (patch.ajustes) novo.ajustes = { ...(atual.ajustes || {}), ...patch.ajustes };
  return novo;
}

/** Junta as mudanças, manda um PUT depois de 300 ms parado e atualiza a
 * imagem "depois" depois de 600 ms — evita bater o servidor a cada tick. */
function agendarSalvar(patch) {
  corAtual = mesclarPatch(corAtual, patch);
  pendentePut = mesclarPatch(pendentePut, patch);

  clearTimeout(tPut);
  tPut = setTimeout(async () => {
    const corpo = pendentePut;
    pendentePut = {};
    await enviarPut(corpo);
  }, 300);

  clearTimeout(tImg);
  tImg = setTimeout(() => {
    versaoDepois++;
    atualizarPreview();
  }, 600);
}

async function enviarPut(corpo) {
  if (!nomeProjeto || !Object.keys(corpo).length) return;
  const r = await fetch(`/api/projeto/${encodeURIComponent(nomeProjeto)}/cor`, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo),
  });
  if (!r.ok) return;
  const dados = await r.json();
  if (dados.cor) {
    corAtual = {
      lut: dados.cor.lut ?? null,
      intensidade: dados.cor.intensidade ?? 1,
      ajustes: { ...AJUSTES_PADRAO, ...(dados.cor.ajustes || {}) },
    };
  }
  precisaRefazer = !!dados.precisaRefazer;
  refletirEstado();
  atualizarFaixaAviso();
}
