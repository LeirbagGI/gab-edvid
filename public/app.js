const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

// Cores dos blocos: usadas nos botoes da ficha do clipe. Na timeline o rotulo
// e branco, como na referencia.
const CORES_BLOCO = { HOOK: '#f73d9e', DINAMICA: '#f97a1e', RECURSOS: '#38d6d2', CTA: '#8b6bff' };
const BLOCOS = Object.keys(CORES_BLOCO);

import {
  HEADLINES, LEGENDAS, TIPOS_EDICAO, ELEMENTOS, cssDe,
} from '/shared/presets.js';
import { amostraLegenda, CICLO } from '/amostra-legenda.js';
import {
  TRANSICOES, EFEITOS, INTRO_PADRAO, ANIMACOES_INTRO, transicaoPadrao,
} from '/shared/efeitos.js';
import { montarCor, aplicarCor } from '/cor.js';
import {
  montarLegendaEditor, aplicarLegendaEditor, aoTempoLegendaEditor,
} from '/legenda-editor.js';

/* -------------------------------------------------- legenda: DNA e uso (UI-2) */
// Mapa fixo (docs/planejamento/legendas-referencia.md, recomendação de uso por
// preset) — só os 20 novos da pesquisa entram aqui; os 9+5 antigos ficam sem
// tag ("Clássicos" no filtro).
const TAG_LEGENDA = {
  hormozi: 'palestra', podcast: 'palestra', beast: 'palestra',
  'pop-palavra': 'palestra', marcal: 'palestra', tremor: 'palestra',
  'dark-venda': 'venda', primo: 'venda', empilhada: 'venda', emoji: 'venda',
  premium: 'autoridade', peso: 'autoridade', 'moldura-ouro': 'autoridade',
  desfoque: 'autoridade', brilho: 'autoridade',
};
const NOME_TAG_LEGENDA = { palestra: 'palestra e corte', venda: 'venda', autoridade: 'autoridade' };
const FILTROS_TAG_LEGENDA = [
  ['', 'Todos'], ['palestra', 'Palestra e corte'], ['venda', 'Venda'],
  ['autoridade', 'Autoridade'], ['classico', 'Clássicos'],
];

/** Linha pequena "pop · destaque": entrada (se != nenhuma), ativa (se diferente
 * da entrada), e "destaque" quando o preset tem `destaque(cor)` (marca
 * palavra-chave numa cor própria). */
function dnaLegenda(l) {
  const partes = [];
  if (l.entrada && l.entrada !== 'nenhuma') partes.push(l.entrada);
  if (l.ativa && l.ativa !== 'nenhuma' && l.ativa !== l.entrada) partes.push(l.ativa);
  if (l.destaque) partes.push('destaque');
  return partes.join(' · ');
}

/* ---------------------------------------------------------------- presets */
// Os mockups de celular de cada tipo de edicao. So isso e local: e ilustracao
// da aba Estilo, nao entra no render.
const FONE = {
  limpa: `<div class="barras"><s style="width:26px"></s><s style="width:17px"></s></div>
          <div class="cabeca"></div>
          <div class="legendaMini"><s></s><s></s><s></s></div>
          <div class="cabeca" style="width:44px;height:44px"></div>`,
  'tela-dividida': `<div class="imagem">&#9650;</div>
          <div class="legendaMini"><s></s><s></s><s></s></div>
          <div class="cabeca"></div>
          <div class="cabeca" style="width:44px;height:44px"></div>`,
  'tela-dividida-2': `<div class="cabeca"></div>
          <div class="legendaMini"><s></s><s></s><s></s></div>
          <div class="divisor"></div>
          <div class="imagem">&#9650;</div>`,
};

/* ---------------------------------------------------------------- estado */
let P = null;
let ultimoAberto = null;
let elParcial = null; // bolha do texto parcial do Claude, enquanto ele ainda esta pensando

const fmt = (s) => {
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toFixed(2).padStart(5, '0')}`;
};
const fmtCurto = (s) => {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}.00`;
};

/* ---------------------------------------------------------------- abas */
$$('.abas button, .btProjetos').forEach((b) => {
  b.onclick = () => {
    $$('.abas button, .btProjetos').forEach((x) => x.classList.toggle('on', x === b));
    $$('.aba').forEach((s) => s.classList.toggle('on', s.id === `aba-${b.dataset.aba}`));
    if (b.dataset.aba === 'estilo') desenharAmostras((performance.now() / 1000) % CICLO);
  };
});

// Util para verificacao visual e para o usuario: ?aba=estilo abre direto
// naquela aba no carregamento (a Fase 1 abre por padrao, sem clique).
const abaNaUrl = new URLSearchParams(location.search).get('aba');
if (abaNaUrl) {
  const botao = $$('.abas button, .btProjetos').find((b) => b.dataset.aba === abaNaUrl);
  if (botao) botao.click();
}

/* ---------------------------------------------------------------- carregar */
async function listarProjetos() {
  const lista = await (await fetch('/api/projetos')).json();
  const sel = $('#selProjeto');
  const antes = sel.value;
  sel.innerHTML = lista.map((p) => `<option value="${p.nome}">${p.nome}</option>`).join('')
    || '<option>— nenhum —</option>';
  // Mantém o projeto aberto se ele ainda existe; senão abre o mais recente.
  if (lista.some((p) => p.nome === antes)) sel.value = antes;
  if (lista.length) await abrir(sel.value || lista[0].nome);
  return lista;
}
$('#selProjeto').onchange = (e) => abrir(e.target.value);

async function abrir(nome) {
  const r = await fetch(`/api/projeto/${encodeURIComponent(nome)}`);
  if (r.ok) aplicar(await r.json());
}

function aplicar(projeto) {
  P = projeto;
  const f1 = P.fase1 || {};
  // Nome do arquivo sem extensão; se for enorme (download com hash), corta.
  let arq = P.origem.arquivo.replace(/\.[^.]+$/, '');
  if (arq.length > 26) arq = `${arq.slice(0, 24)}…`;
  $('#hTitulo').textContent = `${P.nome} — ${arq}`;

  const status = {
    'aguardando-aprovacao': `Fase 1 — corte orgânico pronto (${(f1.duracao || 0).toFixed(1).replace('.', ',')}s). Aprova?`,
    aprovada: 'Corte aprovado — escolha o estilo da Fase 2 na aba Estilo',
    ajustar: 'Corte marcado para ajuste — mexa na timeline e refaça',
    editado: 'Timeline editada à mão — rode --refazer e aprove',
  }[f1.status] || '';

  // Com a Fase 2 pronta o cabeçalho resume o que foi aplicado, como na referência.
  const f2 = P.fase2 || {};
  if (f2.status === 'pronta') {
    const nome = (lista, id) => lista.find((x) => x.id === id)?.nome || id;
    $('#hSub').textContent = `Fase 2 entregue — ${nome(TIPOS_EDICAO, P.estilo.tipoEdicao)}`
      + ` · ${nome(HEADLINES, P.estilo.estiloHeadline)} · ${nome(LEGENDAS, P.estilo.estiloLegenda)}`;
  } else {
    $('#hSub').textContent = status;
  }

  if (!f1.clipes?.length) {
    $('#corteVazio').style.display = '';
    $('#corteConteudo').style.display = 'none';
    return;
  }
  $('#corteVazio').style.display = 'none';
  $('#corteConteudo').style.display = '';
  // O painel de legenda abre com o primeiro clipe já selecionado — senão o
  // usuário chega numa lista vazia e não entende que precisa clicar antes.
  if (!clipeSel || !f1.clipes.some((c) => c.id === clipeSel)) {
    clipeSel = f1.clipes.find((c) => c.ativo !== false)?.id || null;
  }

  // Todo projeto chama o arquivo de fase1-corte.mp4, então comparar o NOME
  // nunca detecta troca de projeto. Compara a URL inteira.
  const v = $('#player');
  // Toca o proxy leve quando existe (720p, quadro-chave a cada 0,5 s); o
  // arquivo completo fica no botão de baixar. `?v=` versiona para o cache.
  const src = `/midia/${encodeURIComponent(P.nome)}/${f1.preview || f1.arquivo}?v=${encodeURIComponent(f1.renderizadoEm || '')}`;
  ligarBaixar('baixarF1', `/midia/${encodeURIComponent(P.nome)}/${f1.arquivo}`, `${P.nome}-corte.mp4`);
  if (v.dataset.src !== src) {
    v.dataset.src = src;
    v.src = src;
    v.addEventListener('loadedmetadata', () => { v.currentTime = 0.05; }, { once: true });
  }
  $('#tTotal').textContent = fmt(f1.duracao || 0);

  const editado = f1.status === 'editado';
  $('#avisoEditado').style.display = editado ? '' : 'none';
  $('#avisoEditado').textContent = editado
    ? 'timeline mexida — clique em Refazer o corte para valer no arquivo' : '';

  desenharTimeline();
  desenharRemovidos();
  aplicarEstilo();
  aplicarCor(P);
  aplicarFase2();
  desenharConversa();
}

/* --------------------------------------------------------------- timeline */
/*
 * Uma fabrica, duas instancias: a Fase 1 desenha o corte e a Fase 2 desenha o
 * video final. Sem isso as duas timelines iam divergir com o tempo.
 */
function criarTimeline({
  sufixo, video, dados, aoSelecionar, comTransicoes = false, aoTempo,
}) {
  const q = (id) => $(`#${id}${sufixo}`);
  const player = $(`#${video}`);
  let pxPorSeg = 52;
  let miniaturas = true;

  const el = {
    trilhas: q('trilhas'), pista: q('pista'), regua: q('regua'),
    marca: q('trilhaMarca'), clipes: q('trilhaClipes'), onda: q('trilhaOnda'),
    cabecote: q('cabecote'), zoom: q('zoom'), tAtual: q('tAtual'), tTotal: q('tTotal'),
  };

  function desenhar() {
    const d = dados();
    if (!d) return;
    const largura = Math.max(320, d.duracao * pxPorSeg);
    el.pista.style.width = `${largura}px`;
    el.tTotal.textContent = fmt(d.duracao);

    const passo = pxPorSeg > 110 ? 1 : pxPorSeg > 55 ? 2 : pxPorSeg > 26 ? 5 : 10;
    let regua = '';
    for (let t = 0; t <= d.duracao; t += passo) {
      regua += `<i style="left:${t * pxPorSeg}px">${fmtCurto(t)}</i>`;
      for (let k = 1; k < 4; k++) {
        const x = (t + (passo * k) / 4) * pxPorSeg;
        if (x < largura) regua += `<u style="left:${x}px"></u>`;
      }
    }
    el.regua.innerHTML = regua;

    el.clipes.innerHTML = d.clipes.map((c) => `
      <div class="clipe${d.selecionado === c.id ? ' sel' : ''}" data-id="${c.id}"
        style="left:${c.inicio * pxPorSeg}px;width:${Math.max(16, c.duracao * pxPorSeg - 2)}px;
               ${miniaturas
                 ? `background-image:url(/midia/${encodeURIComponent(P.nome)}/thumbs/${c.id}.jpg)`
                 : `background:${CORES_BLOCO[c.bloco]}22`}">
        <span class="tag">${c.bloco}</span>
        <span class="dur">${c.duracao.toFixed(2)}s</span>
      </div>`).join('');

    if (aoSelecionar) {
      el.clipes.querySelectorAll('.clipe').forEach((n) => {
        n.onclick = () => {
          const c = d.clipes.find((x) => x.id === n.dataset.id);
          player.currentTime = c.inicio + 0.02;
          aoSelecionar(c.id);
        };
        // Alças de aparar: arrastar a borda muda onde o clipe começa/termina
        // no vídeo de origem. O servidor já aceitava isso; faltava a alça.
        for (const lado of ['ini', 'fim']) {
          const alca = document.createElement('span');
          alca.className = `alca ${lado}`;
          alca.addEventListener('pointerdown', (e) => aparar(e, n.dataset.id, lado));
          n.appendChild(alca);
        }
      });
    }

    // Marcador de transição na borda entre um clipe e o seguinte: n clipes
    // ativos e contíguos dão n-1 marcadores. Só a Fase 1 edita isso — a
    // Fase 2 só assiste o resultado.
    if (comTransicoes) {
      for (let i = 0; i < d.clipes.length - 1; i++) {
        const alvo = d.clipes[i + 1];
        const marca = document.createElement('i');
        marca.className = `marcaTransicao${alvo.transicao ? ' on' : ''}`;
        marca.dataset.clipe = alvo.id;
        marca.style.left = `${alvo.inicio * pxPorSeg}px`;
        marca.title = alvo.transicao
          ? `entrada de ${alvo.id}: ${(TRANSICOES.find((t) => t.id === alvo.transicao.tipo) || {}).nome || alvo.transicao.tipo}`
          : 'entrada usa a transição do projeto';
        marca.onclick = (e) => { e.stopPropagation(); abrirPopoverTransicao(marca, alvo.id); };
        el.clipes.appendChild(marca);
      }
    }

    const picos = d.picos || [];
    const barras = Math.max(1, Math.floor(largura / 3.5));
    const salto = picos.length / barras;
    let onda = '';
    for (let i = 0; i < barras; i++) {
      onda += `<i style="height:${Math.max(2, (picos[Math.floor(i * salto)] ?? 0) * 56)}px"></i>`;
    }
    el.onda.innerHTML = onda;

    const em = Number(el.marca.dataset.em);
    el.marca.innerHTML = Number.isFinite(em) && em > 0
      ? `<span class="pinoMarca" style="left:${em * pxPorSeg}px"></span>` : '';

    mover();
  }

  const mover = () => { el.cabecote.style.left = `${(player.currentTime || 0) * pxPorSeg}px`; };

  function seguir() {
    const x = (player.currentTime || 0) * pxPorSeg;
    const c = el.trilhas;
    const m = 60;
    if (x < c.scrollLeft + m) c.scrollLeft = Math.max(0, x - m);
    else if (x > c.scrollLeft + c.clientWidth - m) c.scrollLeft = x - c.clientWidth + m;
  }

  /* ---- agulha arrastavel ---- */
  const tempoEm = (clientX) => {
    const r = el.pista.getBoundingClientRect();
    return Math.min(dados()?.duracao ?? 0, Math.max(0, (clientX - r.left) / pxPorSeg));
  };
  let tocava = false;
  const arrasta = (e) => {
    player.currentTime = tempoEm(e.clientX);
    el.tAtual.textContent = fmt(player.currentTime);
    mover();
  };
  const fim = () => {
    window.removeEventListener('pointermove', arrasta);
    el.cabecote.classList.remove('arrastando');
    if (tocava) player.play();
  };
  const comeca = (e) => {
    e.preventDefault();
    tocava = !player.paused;
    player.pause();
    el.cabecote.classList.add('arrastando');
    arrasta(e);
    window.addEventListener('pointermove', arrasta);
    window.addEventListener('pointerup', fim, { once: true });
  };
  [el.cabecote, el.regua, el.marca, el.onda].forEach((n) => n.addEventListener('pointerdown', comeca));

  /* ---- transporte ---- */
  player.ontimeupdate = () => {
    el.tAtual.textContent = fmt(player.currentTime);
    mover();
    if (!player.paused) seguir();
    if (aoTempo) aoTempo(player.currentTime);
  };
  const iconePlay = (tocando) => (tocando
    ? '<svg viewBox="0 0 16 16"><rect x="3" y="2" width="4" height="12" fill="currentColor"/><rect x="9" y="2" width="4" height="12" fill="currentColor"/></svg>'
    : '<svg viewBox="0 0 16 16"><path d="M3 2l11 6-11 6z" fill="currentColor"/></svg>');
  player.onplay = () => { q('btnPlay').innerHTML = iconePlay(true); };
  player.onpause = () => { q('btnPlay').innerHTML = iconePlay(false); };
  q('btnPlay').onclick = () => (player.paused ? player.play() : player.pause());
  q('btnMudo').onclick = (e) => {
    player.muted = !player.muted;
    e.currentTarget.style.color = player.muted ? 'var(--fraco)' : 'var(--texto)';
  };
  q('btnIn').onclick = (e) => e.currentTarget.classList.toggle('on');
  el.zoom.oninput = (e) => { pxPorSeg = Number(e.target.value); desenhar(); };
  q('btnAjustar').onclick = () => {
    pxPorSeg = Math.max(4, Math.min(260, (el.trilhas.clientWidth - 8) / (dados()?.duracao || 1)));
    el.zoom.value = String(Math.round(pxPorSeg));
    desenhar();
  };

  /* ---- cabecotes de trilha ---- */
  q('ctMarca').onclick = () => {
    q('btnIn').classList.add('on');
    el.marca.dataset.em = String(player.currentTime.toFixed(3));
    desenhar();
  };
  q('ctVideo').onclick = (e) => {
    miniaturas = !miniaturas;
    e.currentTarget.classList.toggle('desligado', !miniaturas);
    desenhar();
  };
  q('ctAudio').onclick = (e) => {
    player.muted = !player.muted;
    e.currentTarget.classList.toggle('desligado', player.muted);
    q('btnMudo').style.color = player.muted ? 'var(--fraco)' : 'var(--texto)';
  };

  /**
   * Arrasta a borda de um clipe. Mexe em origemInicio/origemFim (tempo no vídeo
   * bruto) e reposiciona todo mundo depois dele, para o preview ser honesto.
   */
  function aparar(ev, id, lado) {
    ev.preventDefault();
    ev.stopPropagation();
    const clipes = P.fase1.clipes;
    const i = clipes.findIndex((c) => c.id === id);
    const c = clipes[i];
    const original = { ini: c.origemInicio, fim: c.origemFim };
    const x0 = ev.clientX;
    const MIN = 0.15;

    // Só limita pelo vizinho quando os dois são contíguos na origem.
    const ant = clipes[i - 1];
    const prox = clipes[i + 1];
    const pisoIni = (ant && ant.origemFim <= original.ini) ? ant.origemFim : 0;
    const tetoFim = (prox && prox.origemInicio >= original.fim)
      ? prox.origemInicio : (P.origem?.duracao ?? original.fim);

    const mover = (e) => {
      const delta = (e.clientX - x0) / pxPorSeg;
      if (lado === 'ini') {
        c.origemInicio = Math.min(original.fim - MIN,
          Math.max(pisoIni, original.ini + delta));
      } else {
        c.origemFim = Math.max(original.ini + MIN,
          Math.min(tetoFim, original.fim + delta));
      }
      c.duracao = Number((c.origemFim - c.origemInicio).toFixed(3));
      recolocar();
      desenhar();
    };
    const soltar = async () => {
      window.removeEventListener('pointermove', mover);
      await fetch(`/api/projeto/${encodeURIComponent(P.nome)}/clipe/${id}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ origemInicio: c.origemInicio, origemFim: c.origemFim }),
      });
      abrir(P.nome);
    };
    window.addEventListener('pointermove', mover);
    window.addEventListener('pointerup', soltar, { once: true });
  }

  /** Reempilha os clipes ativos na linha do tempo depois de um aparo. */
  function recolocar() {
    let t = 0;
    for (const c of P.fase1.clipes) {
      if (c.ativo === false) continue;
      c.inicio = Number(t.toFixed(3));
      t += c.duracao;
      c.fim = Number(t.toFixed(3));
    }
    P.fase1.duracao = Number(t.toFixed(2));
  }

  return { desenhar, player, get px() { return pxPorSeg; } };
}

let clipeSel = null;

const tlCorte = criarTimeline({
  sufixo: '', video: 'player', comTransicoes: true,
  dados: () => (P?.fase1?.clipes?.length ? {
    duracao: P.fase1.duracao,
    clipes: P.fase1.clipes.filter((c) => c.ativo !== false),
    picos: P.fase1.picos,
    selecionado: clipeSel,
  } : null),
  aoSelecionar: (id) => {
    clipeSel = id; tlCorte.desenhar(); desenharFicha(); desenharLegendaEditorPainel();
  },
  aoTempo: (t) => aoTempoLegendaEditor(t),
});

/** Redesenha o painel "Legenda" da Fase 1 com o clipe selecionado atual. */
function desenharLegendaEditorPainel() {
  if (P) aplicarLegendaEditor(P, clipeSel);
}

/* ------------------------------------------------ popover de transição */
/*
 * Um popover só, reaproveitado por qualquer marcador clicado — mais simples
 * do que um por marcador, e evita ficar pendurado quando desenhar() redesenha
 * a trilha (o popover mora em document.body, fora de #trilhaClipes).
 */
let popTransicao = null;
function fecharPopoverTransicao() {
  popTransicao?.remove();
  popTransicao = null;
}
function abrirPopoverTransicao(marcaEl, clipeId) {
  fecharPopoverTransicao();
  const pop = document.createElement('div');
  pop.className = 'popTransicao';
  pop.innerHTML = `<button data-t="">Usar a do projeto</button>${
    TRANSICOES.map((t) => `<button data-t="${t.id}">${t.nome}</button>`).join('')}`;
  document.body.appendChild(pop);
  const r = marcaEl.getBoundingClientRect();
  pop.style.left = `${Math.max(4, r.left - 4)}px`;
  pop.style.top = `${r.bottom + 6}px`;
  pop.querySelectorAll('button').forEach((b) => {
    b.onclick = (e) => {
      e.stopPropagation();
      const tipo = b.dataset.t;
      patchClipe(clipeId, { transicao: tipo ? { tipo } : null });
      fecharPopoverTransicao();
    };
  });
  popTransicao = pop;
  setTimeout(() => document.addEventListener('click', fecharPopoverTransicao, { once: true }), 0);
}

const tlVisual = criarTimeline({
  sufixo: '2', video: 'playerFinal',
  dados: () => (P?.fase2?.status === 'pronta' ? {
    duracao: P.fase2.duracao || P.fase1.duracao,
    clipes: P.fase1.clipes.filter((c) => c.ativo !== false),
    picos: P.fase2.picos || P.fase1.picos,
  } : null),
});

const player = tlCorte.player;

// Um vídeo que não carrega não pode falhar calado — é o que aconteceu aqui.
for (const [v, onde] of [[tlCorte.player, '#legendaPrev'], [tlVisual.player, '#legendaFinal']]) {
  v.onerror = () => {
    const el = $(onde);
    if (el) {
      el.textContent = 'não consegui carregar o vídeo — o arquivo sumiu da pasta do projeto?';
      el.style.color = 'var(--rosa)';
    }
  };
  v.addEventListener('loadeddata', () => {
    const el = $(onde);
    if (el) el.style.color = '';
  });
  // Clicar no próprio vídeo dá play/pause, como em qualquer player.
  v.addEventListener('click', () => (v.paused ? v.play() : v.pause()));
  v.style.cursor = 'pointer';
}

function desenharTimeline() { tlCorte.desenhar(); desenharLegendaEditorPainel(); }

function desenharFicha() {
  const c = P.fase1.clipes.find((x) => x.id === clipeSel);
  const ficha = $('#fichaClipe');
  if (!c) { ficha.style.display = 'none'; return; }
  ficha.style.display = '';
  $('#clipeTexto').textContent = `“${c.texto}”`;
  $('#clipeBlocos').innerHTML = BLOCOS.map((b) => {
    const on = b === c.bloco;
    return `<button data-b="${b}" style="${on
      ? `background:${CORES_BLOCO[b]};border-color:${CORES_BLOCO[b]};color:#08101c`
      : `color:${CORES_BLOCO[b]}`}">${b}</button>`;
  }).join('') + `<button data-desligar style="margin-left:8px;color:var(--fraco)">
      ${c.ativo === false ? 'Religar clipe' : 'Desligar clipe'}</button>`;

  $('#clipeBlocos').querySelectorAll('button').forEach((el) => {
    el.onclick = () => (el.hasAttribute('data-desligar')
      ? patchClipe(c.id, { ativo: c.ativo === false })
      : patchClipe(c.id, { bloco: el.dataset.b }));
  });

  // Efeitos deste clipe: sobrescrevem os do projeto, chave a chave, enquanto
  // ele toca. Sempre manda o objeto inteiro (mesclado localmente) — o mesmo
  // padrão de "elementos" em salvarEstilo, para não perder chave nenhuma.
  const efeitos = c.efeitos || {};
  $('#clipeEfeitosToggles').innerHTML = ['grao', 'vinheta', 'shake'].map((k) => {
    const on = typeof efeitos[k] === 'number';
    const nome = EFEITOS.find((e) => e.id === k)?.nome || k;
    return `<button class="toggle compacto${on ? ' on' : ''}" data-k="${k}" type="button">
      <span class="caixa">✓</span>${nome}</button>`;
  }).join('');
  $('#clipeEfeitosToggles').querySelectorAll('[data-k]').forEach((el) => {
    el.onclick = () => {
      const k = el.dataset.k;
      const atuais = { ...(c.efeitos || {}) };
      if (typeof atuais[k] === 'number') delete atuais[k]; else atuais[k] = 0.5;
      patchClipe(c.id, { efeitos: Object.keys(atuais).length ? atuais : null });
    };
  });
  const campoCongelar = $('#clipeCongelar');
  campoCongelar.value = efeitos.congelar ?? 0;
  campoCongelar.onchange = (e) => {
    const v = Math.max(0, Math.min(5, Number(e.target.value) || 0));
    const atuais = { ...(c.efeitos || {}) };
    if (v > 0) atuais.congelar = v; else delete atuais.congelar;
    patchClipe(c.id, { efeitos: Object.keys(atuais).length ? atuais : null });
  };
}

async function patchClipe(id, corpo) {
  await fetch(`/api/projeto/${encodeURIComponent(P.nome)}/clipe/${id}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo),
  });
  abrir(P.nome);
}

function desenharRemovidos() {
  const d = P.fase1.descartados || [];
  const el = $('#removidos');
  if (!d.length) { el.style.display = 'none'; return; }
  el.style.display = '';
  el.innerHTML = `<b>${d.length} trecho(s) removido(s) no corte orgânico</b><ul>${
    d.slice(0, 10).map((x) => `<li>${fmt(x.inicio)} — “${x.texto}” <code>${x.motivos.join(', ')}</code></li>`).join('')
  }</ul>`;
}

// Teclado: setas andam quadro a quadro na timeline da aba aberta.
window.addEventListener('keydown', (e) => {
  const campo = document.activeElement?.tagName;
  if (!P || campo === 'INPUT' || campo === 'TEXTAREA') return;
  const tl = $('#aba-visual').classList.contains('on') ? tlVisual : tlCorte;
  const passo = e.shiftKey ? 1 : 1 / (P.saida?.fps || 30);
  if (e.key === 'ArrowRight') { tl.player.currentTime += passo; e.preventDefault(); }
  if (e.key === 'ArrowLeft') { tl.player.currentTime -= passo; e.preventDefault(); }
  if (e.key === ' ') { tl.player.paused ? tl.player.play() : tl.player.pause(); e.preventDefault(); }
});

$('#btnAprovar').onclick = async () => {
  await fetch(`/api/projeto/${encodeURIComponent(P.nome)}/fase1/aprovar`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  await abrir(P.nome);
  irParaAba('estilo');
};
$('#btnRefazer').onclick = async () => {
  await enfileirar('refazer', { nome: P.nome });
  $('#logEtapa').textContent = 'refazer';
  $('#logMsg').textContent = 'Refazendo o corte com a timeline como está.';
};
$('#btnReprovar').onclick = async () => {
  const observacao = prompt('O que precisa ajustar no corte?') || '';
  await fetch(`/api/projeto/${encodeURIComponent(P.nome)}/fase1/reprovar`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ observacao }) });
  abrir(P.nome);
};

/* ---------------------------------------------------------------- estilo */
function montarEstilo() {
  $('#tipoEdicao').innerHTML = TIPOS_EDICAO.map((t) => `
    <div class="card" data-id="${t.id}">
      <span class="marcaSel">\u2713</span>
      <div class="fone">${FONE[t.id]}</div>
      <div class="nome">${t.nome}</div>
    </div>`).join('');

  const preset = (p, tipo) => `
    <div class="preset" data-id="${p.id}">
      <span class="marcaSel">\u2713</span>
      <div class="amostra" data-amostra="${tipo}:${p.id}"
           ${p.fundoAmostra ? `style="background:${p.fundoAmostra}"` : ''}></div>
    </div>`;
  $('#headlines').innerHTML = HEADLINES.map((h) => preset(h, 'h')).join('');

  // Legenda (UI-2): card maior, com nome e "DNA" vis\u00edveis \u2014 34 amostras
  // min\u00fasculas e sem r\u00f3tulo ningu\u00e9m distinguia (docs/implementacao/ui1-estilo.png).
  const legendaCard = (l) => {
    const tag = TAG_LEGENDA[l.id];
    const dna = dnaLegenda(l);
    return `
    <div class="preset legPreset" data-id="${l.id}" data-tag="${tag || ''}" data-nome="${l.nome.toLowerCase()}">
      <span class="marcaSel">\u2713</span>
      <div class="amostra amostraLeg" data-amostra="l:${l.id}"
           ${l.fundoAmostra ? `style="background:${l.fundoAmostra}"` : ''}></div>
      <div class="nome">${l.nome}</div>
      ${dna ? `<div class="dna">${dna}</div>` : ''}
      ${tag ? `<div class="tagUso">${NOME_TAG_LEGENDA[tag]}</div>` : ''}
    </div>`;
  };
  $('#legendas').innerHTML = LEGENDAS.map(legendaCard).join('');

  $('#elementos').innerHTML = ELEMENTOS.map((e) => `
    <div class="toggle" data-id="${e.id}">
      <span class="caixa">\u2713</span><span class="ic">${e.ic}</span>${e.nome}
    </div>`).join('');

  $('#tipoEdicao').onclick = (e) => escolher(e, '.card', 'tipoEdicao');
  $('#headlines').onclick = (e) => escolher(e, '.preset', 'estiloHeadline');
  $('#legendas').onclick = (e) => escolher(e, '.preset', 'estiloLegenda');
  $('#elementos').onclick = (e) => {
    const el = e.target.closest('.toggle');
    if (!el) return;
    const k = el.dataset.id;
    // "Flash na transi\u00e7\u00e3o" virou atalho para a transi\u00e7\u00e3o de mesmo nome, para
    // n\u00e3o haver dois lugares dizendo coisas diferentes sobre a transi\u00e7\u00e3o.
    if (k === 'flashNaTransicao') {
      const ligado = transicaoPadrao(P.estilo).tipo === 'flash';
      salvarEstilo({ transicao: { tipo: ligado ? 'corte' : 'flash' } });
      return;
    }
    salvarEstilo({ elementos: { ...P.estilo.elementos, [k]: !P.estilo.elementos[k] } });
  };

  montarFiltroLegendas();
  montarAjustesLegenda();
  montarTransicoes();
  montarEfeitos();
  montarIntro();
  animar();
}

/* ---------------------------------------------------- filtro de legendas */
function montarFiltroLegendas() {
  $('#filtroTagLegenda').innerHTML = FILTROS_TAG_LEGENDA
    .map(([v, nome], i) => `<button data-v="${v}" type="button" class="${i === 0 ? 'on' : ''}">${nome}</button>`)
    .join('');
  $('#filtroTagLegenda').onclick = (e) => {
    const el = e.target.closest('button');
    if (!el) return;
    $$('#filtroTagLegenda button').forEach((b) => b.classList.toggle('on', b === el));
    aplicarFiltroLegendas();
  };
  $('#buscaLegenda').oninput = () => aplicarFiltroLegendas();
}

function aplicarFiltroLegendas() {
  const tagAtiva = $('#filtroTagLegenda .on')?.dataset.v || '';
  const busca = $('#buscaLegenda').value.trim().toLowerCase();
  $$('#legendas .legPreset').forEach((el) => {
    const tag = el.dataset.tag;
    const passaTag = !tagAtiva || (tagAtiva === 'classico' ? !tag : tag === tagAtiva);
    const passaBusca = !busca || el.dataset.nome.includes(busca);
    el.style.display = (passaTag && passaBusca) ? '' : 'none';
  });
}

/* --------------------------------------------------- ajustes da legenda */
// PUT .../legenda: override de estilo.legenda por cima do preset. `escolha`
// converte o valor do bot\u00e3o pro corpo que a rota espera (mai\u00fasculas usa
// null pro "do estilo" \u2014 os outros campos n\u00e3o aceitam null, ver
// validarConfigLegenda em src/server/legenda-edicao.js).
function montarAjustesLegenda() {
  const segmento = (idBox, chave, opcoes, escolha) => {
    $(idBox).innerHTML = opcoes.map(([v, nome]) => `<button data-v="${v}" type="button">${nome}</button>`).join('');
    $(idBox).onclick = (e) => {
      const el = e.target.closest('button');
      if (!el) return;
      salvarLegenda({ [chave]: escolha ? escolha(el.dataset.v) : el.dataset.v });
    };
  };
  segmento('#legPosicao', 'posicao', [['baixo', 'Baixo'], ['meio', 'Meio'], ['alto', 'Alto']]);
  segmento('#legAlinhamento', 'alinhamento', [['centro', 'Centro'], ['esquerda', 'Esquerda']]);
  segmento('#legMaiusculas', 'maiusculas',
    [['estilo', 'Do estilo'], ['sempre', 'Sempre'], ['nunca', 'Nunca']],
    (v) => (v === 'estilo' ? null : v === 'sempre'));

  const fmtX = (v) => `${Number(v).toFixed(2).replace('.', ',')}\u00d7`;
  const fmtS = (v) => `${Number(v).toFixed(2).replace('.', ',')}s`;
  $('#legEscala').oninput = (e) => {
    $('#legEscalaValor').textContent = fmtX(e.target.value);
    salvarLegenda({ escala: Number(e.target.value) });
  };
  $('#legAntecedencia').oninput = (e) => {
    $('#legAntecedenciaValor').textContent = fmtS(e.target.value);
    salvarLegenda({ antecedencia: Number(e.target.value) });
  };
  $('#legMaxPalavras').oninput = (e) => {
    $('#legMaxPalavrasValor').textContent = e.target.value;
    salvarLegenda({ maxPalavras: Number(e.target.value) });
  };

  // "posicao"/"escala"/"alinhamento"/"antecedencia"/"maxPalavras" n\u00e3o aceitam
  // null na valida\u00e7\u00e3o do servidor (s\u00f3 "maiusculas" aceita) \u2014 ausentes eles
  // simplesmente n\u00e3o mudam no servidor, ent\u00e3o o reset de verdade \u00e9 local
  // (o card volta a refletir o preset puro na hora).
  $('#btnLegendaPadrao').onclick = () => {
    P.estilo.legenda = {};
    aplicarAjustesLegenda();
    desenharAmostras((performance.now() / 1000) % CICLO);
    salvarLegenda({ maiusculas: null });
  };
}

let tLegenda = null;
let pendenteLegenda = {};
function salvarLegenda(patch) {
  P.estilo.legenda = { ...(P.estilo.legenda || {}), ...patch };
  pendenteLegenda = { ...pendenteLegenda, ...patch };
  aplicarAjustesLegenda();
  desenharAmostras((performance.now() / 1000) % CICLO);

  clearTimeout(tLegenda);
  tLegenda = setTimeout(async () => {
    const corpo = pendenteLegenda;
    pendenteLegenda = {};
    const r = await fetch(`/api/projeto/${encodeURIComponent(P.nome)}/legenda`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo),
    });
    if (r.ok) {
      P.estilo.legenda = await r.json();
      aplicarAjustesLegenda();
    }
  }, 300);
}

function aplicarAjustesLegenda() {
  const l = P?.estilo?.legenda || {};
  $$('#legPosicao button').forEach((b) => b.classList.toggle('on', (l.posicao || 'baixo') === b.dataset.v));
  $$('#legAlinhamento button').forEach((b) => b.classList.toggle('on', (l.alinhamento || 'centro') === b.dataset.v));
  const maiusculasEstado = l.maiusculas === true ? 'sempre' : l.maiusculas === false ? 'nunca' : 'estilo';
  $$('#legMaiusculas button').forEach((b) => b.classList.toggle('on', maiusculasEstado === b.dataset.v));

  const escala = typeof l.escala === 'number' ? l.escala : 1;
  if (document.activeElement !== $('#legEscala')) $('#legEscala').value = String(escala);
  $('#legEscalaValor').textContent = `${escala.toFixed(2).replace('.', ',')}\u00d7`;

  const antecedencia = typeof l.antecedencia === 'number' ? l.antecedencia : 0.12;
  if (document.activeElement !== $('#legAntecedencia')) $('#legAntecedencia').value = String(antecedencia);
  $('#legAntecedenciaValor').textContent = `${antecedencia.toFixed(2).replace('.', ',')}s`;

  const maxPalavras = typeof l.maxPalavras === 'number' ? l.maxPalavras : 4;
  if (document.activeElement !== $('#legMaxPalavras')) $('#legMaxPalavras').value = String(maxPalavras);
  $('#legMaxPalavrasValor').textContent = String(maxPalavras);
}

/* --------------------------------------------------------------- transi\u00e7\u00e3o */
function montarTransicoes() {
  $('#transicoesGrade').innerHTML = TRANSICOES.map((t) => `
    <div class="preset transPreset" data-id="${t.id}" title="${t.descricao}">
      <span class="marcaSel">\u2713</span>
      <div class="amostraTrans tipo-${t.id}"><span class="ret retA"></span><span class="ret retB"></span></div>
      <div class="nomeTrans">${t.nome}</div>
    </div>`).join('');
  $('#transicoesGrade').onclick = (e) => {
    const el = e.target.closest('.transPreset');
    if (!el) return;
    salvarEstilo({ transicao: { tipo: el.dataset.id } });
  };
}

/* ---------------------------------------------------------------- efeitos */
// Mapa do id do cat\u00e1logo (kebab-case) para a chave real em `estilo.efeitos`.
const CHAVE_EFEITO = {
  grao: 'grao', vinheta: 'vinheta', shake: 'shake',
  'blur-fundo': 'blurFundo', 'barra-progresso': 'barraProgresso', letterbox: 'letterbox',
};
const EFEITOS_COM_INTENSIDADE = new Set(['grao', 'vinheta', 'shake']);
const EFEITOS_PROJETO = EFEITOS.filter((e) => e.escopo === 'projeto');

function efeitoLigado(efeitos, id) {
  const e = efeitos || {};
  if (EFEITOS_COM_INTENSIDADE.has(id)) return typeof e[CHAVE_EFEITO[id]] === 'number' && e[CHAVE_EFEITO[id]] > 0;
  if (id === 'barra-progresso') return !!e.barraProgresso;
  return !!e[CHAVE_EFEITO[id]];
}

function montarEfeitos() {
  $('#efeitosGrade').innerHTML = EFEITOS_PROJETO.map((e) => {
    if (EFEITOS_COM_INTENSIDADE.has(e.id)) {
      return `<div class="efeitoLinha" data-id="${e.id}">
        <button class="toggle" data-toggle="${e.id}" type="button">
          <span class="caixa">\u2713</span>${e.nome}</button>
        <input type="range" min="0" max="100" value="0" data-range="${e.id}" disabled>
      </div>`;
    }
    if (e.id === 'barra-progresso') {
      return `<div class="efeitoLinha" data-id="${e.id}">
        <button class="toggle" data-toggle="${e.id}" type="button">
          <span class="caixa">\u2713</span>${e.nome}</button>
        <div class="segmentado" data-posicao style="display:none">
          <button data-pos="topo" type="button">Topo</button>
          <button data-pos="base" type="button">Base</button>
        </div>
      </div>`;
    }
    return `<div class="efeitoLinha" data-id="${e.id}">
      <button class="toggle" data-toggle="${e.id}" type="button">
        <span class="caixa">\u2713</span>${e.nome}</button>
    </div>`;
  }).join('');

  $('#efeitosGrade').onclick = (e) => {
    const tBtn = e.target.closest('[data-toggle]');
    if (tBtn) { alternarEfeito(tBtn.dataset.toggle); return; }
    const pBtn = e.target.closest('[data-pos]');
    if (pBtn) salvarEfeito('barraProgresso', { posicao: pBtn.dataset.pos });
  };

  let tRange = null;
  $('#efeitosGrade').addEventListener('input', (e) => {
    const r = e.target.closest('input[type=range]');
    if (!r) return;
    clearTimeout(tRange);
    tRange = setTimeout(() => salvarEfeito(CHAVE_EFEITO[r.dataset.range], Number(r.value) / 100), 300);
  });
}

function alternarEfeito(id) {
  const chave = CHAVE_EFEITO[id];
  const atual = { ...(P.estilo.efeitos || {}) };
  if (EFEITOS_COM_INTENSIDADE.has(id)) {
    if (typeof atual[chave] === 'number') delete atual[chave]; else atual[chave] = 0.5;
  } else if (id === 'barra-progresso') {
    if (atual.barraProgresso) delete atual.barraProgresso; else atual.barraProgresso = { posicao: 'topo' };
  } else {
    atual[chave] = !atual[chave];
    if (!atual[chave]) delete atual[chave];
  }
  salvarEstilo({ efeitos: atual });
}

function salvarEfeito(chave, valor) {
  const atual = { ...(P.estilo.efeitos || {}), [chave]: valor };
  salvarEstilo({ efeitos: atual });
}

/* ------------------------------------------------------------------ intro */
function montarIntro() {
  $('#introAnimacao').innerHTML = ANIMACOES_INTRO.map((a) => `<option value="${a}">${a}</option>`).join('');

  $('#fIntro').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f || !P) return;
    const fd = new FormData();
    fd.append('arquivo', f);
    fd.append('duracao', String(Number($('#introDuracao').value) || INTRO_PADRAO.duracao));
    fd.append('animacao', $('#introAnimacao').value || INTRO_PADRAO.animacao);
    fd.append('headline', $('#introHeadlineToggle').classList.contains('on') ? '1' : '0');
    await fetch(`/api/projeto/${encodeURIComponent(P.nome)}/intro`, { method: 'POST', body: fd });
    e.target.value = '';
    abrir(P.nome);
  };

  $('#introDuracao').onchange = (e) => {
    const v = Math.max(1, Math.min(6, Number(e.target.value) || INTRO_PADRAO.duracao));
    salvarIntro({ duracao: v });
  };
  $('#introAnimacao').onchange = (e) => salvarIntro({ animacao: e.target.value });
  $('#introHeadlineToggle').onclick = () => {
    salvarIntro({ headline: !$('#introHeadlineToggle').classList.contains('on') });
  };
  $('#btnTirarIntro').onclick = async () => {
    if (!P) return;
    await fetch(`/api/projeto/${encodeURIComponent(P.nome)}/intro`, { method: 'DELETE' });
    abrir(P.nome);
  };
}

async function salvarIntro(patch) {
  const r = await fetch(`/api/projeto/${encodeURIComponent(P.nome)}/intro`, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch),
  });
  if (r.ok) {
    const corpo = await r.json().catch(() => patch);
    P.intro = { ...P.intro, ...corpo };
    aplicarIntro();
  }
}

function aplicarIntro() {
  const intro = P.intro;
  $('#btnTirarIntro').style.display = intro ? '' : 'none';
  $('#introCampos').style.display = intro ? '' : 'none';
  if (!intro) { $('#introPreview').innerHTML = ''; return; }
  const src = `/midia/${encodeURIComponent(P.nome)}/${intro.arquivo}`;
  $('#introPreview').innerHTML = intro.tipo === 'video'
    ? `<video src="${src}" muted></video>` : `<img src="${src}" alt="intro">`;
  const campoDur = $('#introDuracao');
  campoDur.value = intro.duracao ?? INTRO_PADRAO.duracao;
  campoDur.disabled = intro.tipo === 'video';
  $('#introAnimacao').value = intro.animacao || INTRO_PADRAO.animacao;
  $('#introHeadlineToggle').classList.toggle('on', !!intro.headline);
}

/* ------------------------------------------------------- amostras animadas */
/*
 * Cada card roda a mesma animacao que o preset faz no video: a legenda revela
 * palavra por palavra na janela do preset, a headline entra e sai. Um unico
 * requestAnimationFrame move todos, entao os cards ficam em sincronia.
 */
function amostraHeadline(p, t, cor) {
  // Entra em 0,35 s, segura o ciclo inteiro e sai nos ultimos 0,25 s — o mesmo
  // arco do render, sem deixar o card muito tempo em branco.
  const dentro = Math.min(1, t / 0.35);
  const fora = Math.min(1, Math.max(0, (t - (CICLO - 0.25)) / 0.25));
  const op = (dentro * (1 - fora)).toFixed(3);
  const y = ((1 - dentro) * -14 + fora * 8).toFixed(1);
  const est = cssDe(p.estilo(cor));
  const linhas = p.amostra.split('\n').map((l, i) => `
    <span style="display:block${p.corSegundaLinha && i === 1 ? `;color:${cor}` : ''}">${l}</span>`).join('');
  return `<span style="display:inline-block;opacity:${op};transform:translateY(${y}px);${est}">${linhas}</span>`;
}

function desenharAmostras(t) {
  const cor = P?.estilo?.corDestaque || '#EE7533';
  $$('[data-amostra]').forEach((el) => {
    const [tipo, id] = el.dataset.amostra.split(':');
    const lista = tipo === 'h' ? HEADLINES : LEGENDAS;
    const p = lista.find((x) => x.id === id);
    if (!p) return;
    const html = tipo === 'h' ? amostraHeadline(p, t, cor) : amostraLegenda(p, t, cor, P?.estilo?.legenda);
    if (el.dataset.ultimo !== html) { el.innerHTML = html; el.dataset.ultimo = html; }
  });
}

let animando = false;
function animar() {
  // Pinta uma vez ja: o requestAnimationFrame nao roda com a aba em segundo
  // plano, e sem isso os cards ficariam vazios ate o navegador voltar ao ar.
  desenharAmostras(0.9);
  if (animando) return;
  animando = true;
  const passo = () => {
    // So gasta quadro com a aba Estilo aberta.
    if ($('#aba-estilo').classList.contains('on')) {
      desenharAmostras((performance.now() / 1000) % CICLO);
    }
    requestAnimationFrame(passo);
  };
  requestAnimationFrame(passo);
}

function escolher(e, seletor, chave) {
  const el = e.target.closest(seletor);
  if (el) salvarEstilo({ [chave]: el.dataset.id });
}

async function salvarEstilo(patch) {
  const r = await fetch(`/api/projeto/${encodeURIComponent(P.nome)}/estilo`, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) });
  P.estilo = await r.json();
  aplicarEstilo();
}

function aplicarEstilo() {
  const s = P.estilo || {};
  const cor = (s.corDestaque || '#FF5200').toUpperCase();
  document.documentElement.style.setProperty('--destaque', cor);
  $('#corPicker').value = cor;
  $('#corHex').value = cor;
  $('#bolaCor').style.background = cor;

  $$('#tipoEdicao .card').forEach((el) => el.classList.toggle('on', el.dataset.id === s.tipoEdicao));
  $$('#headlines .preset').forEach((el) => el.classList.toggle('on', el.dataset.id === s.estiloHeadline));
  $$('#legendas .preset').forEach((el) => el.classList.toggle('on', el.dataset.id === s.estiloLegenda));
  aplicarAjustesLegenda();

  const transicao = transicaoPadrao(s);
  $$('#elementos .toggle').forEach((el) => {
    const k = el.dataset.id;
    const on = k === 'flashNaTransicao' ? transicao.tipo === 'flash' : !!s.elementos?.[k];
    el.classList.toggle('on', on);
  });
  $$('#transicoesGrade .transPreset').forEach((el) => el.classList.toggle('on', el.dataset.id === transicao.tipo));

  const efeitos = s.efeitos || {};
  $$('#efeitosGrade .efeitoLinha').forEach((linha) => {
    const id = linha.dataset.id;
    const ligado = efeitoLigado(efeitos, id);
    linha.querySelector('[data-toggle]').classList.toggle('on', ligado);
    if (EFEITOS_COM_INTENSIDADE.has(id)) {
      const range = linha.querySelector('input[type=range]');
      range.disabled = !ligado;
      if (document.activeElement !== range) {
        range.value = String(Math.round((efeitos[CHAVE_EFEITO[id]] ?? 0) * 100));
      }
    }
    if (id === 'barra-progresso') {
      const seg = linha.querySelector('[data-posicao]');
      seg.style.display = ligado ? '' : 'none';
      seg.querySelectorAll('[data-pos]').forEach((b) => {
        b.classList.toggle('on', efeitos.barraProgresso?.posicao === b.dataset.pos);
      });
    }
  });

  aplicarIntro();

  if (document.activeElement !== $('#obs')) $('#obs').value = s.observacoes || '';

  // A dica só faz sentido quando nenhum dos presets escolhidos usa a cor.
  const usamCor = ['contorno', 'destaque-cor', 'sublinhado'].includes(s.estiloHeadline)
    || ['karaoke', 'karaoke-linhas'].includes(s.estiloLegenda);
  $('#dicaCor').textContent = usamCor ? '' : 'os estilos escolhidos não usam destaque';

  const efeitosLigados = EFEITOS_PROJETO.filter((e) => efeitoLigado(efeitos, e.id)).map((e) => e.nome);
  $('#resumoEstilo').textContent = [
    TIPOS_EDICAO.find((t) => t.id === s.tipoEdicao)?.nome,
    `headline ${HEADLINES.find((h) => h.id === s.estiloHeadline)?.nome || '—'}`,
    `legenda ${LEGENDAS.find((l) => l.id === s.estiloLegenda)?.nome || '—'}`,
    ...ELEMENTOS.filter((e) => e.id !== 'flashNaTransicao' && s.elementos?.[e.id]).map((e) => e.nome),
    transicao.tipo !== 'corte' ? `transição ${TRANSICOES.find((t) => t.id === transicao.tipo)?.nome}` : null,
    ...efeitosLigados,
    P.intro ? 'com intro' : null,
  ].filter(Boolean).join(' · ');
}

$('#corPicker').oninput = (e) => salvarEstilo({ corDestaque: e.target.value });
$('#corHex').onchange = (e) => {
  if (/^#[0-9a-f]{6}$/i.test(e.target.value)) salvarEstilo({ corDestaque: e.target.value });
  else e.target.value = (P.estilo.corDestaque || '#FF5200').toUpperCase();
};
/*
 * Campos de texto: guardam sozinhos depois que você para de digitar, e SEMPRE
 * antes de renderizar. `pendente` é o que ainda não foi para o servidor —
 * clicar em renderizar logo depois de digitar precisa esperar isso.
 */
let pendente = null;
let tTexto;

function guardarTexto(campo, salvar) {
  const el = $(`#${campo}`);
  el.oninput = () => {
    clearTimeout(tTexto);
    const v = el.value;
    pendente = () => salvar(v);
    tTexto = setTimeout(() => { const f = pendente; pendente = null; return f && f(); }, 450);
  };
  // Sair do campo salva na hora, sem esperar o tempo.
  el.onblur = () => {
    clearTimeout(tTexto);
    if (pendente) { const f = pendente; pendente = null; f(); }
  };
}

async function descarregarTexto() {
  clearTimeout(tTexto);
  if (!pendente) return;
  const f = pendente;
  pendente = null;
  await f();
}

guardarTexto('obs', (v) => salvarEstilo({ observacoes: v }));
guardarTexto('headline', (v) => salvarFase2({ headline: v }));


// Abas por nome: clicar por índice quebrou quando a aba Cor entrou no meio.
function irParaAba(nome) {
  const b = $$('.abas button').find((x) => x.dataset.aba === nome);
  if (b) b.click();
}

$('#btnFase2').onclick = async () => {
  if (P.fase1?.status !== 'aprovada') {
    $('#logEtapa').textContent = 'fase 2';
    $('#logMsg').textContent = 'Aprove o corte da Fase 1 antes de renderizar.';
    irParaAba('corte');
    return;
  }
  // Sem isto, digitar a headline e clicar em renderizar em menos de meio
  // segundo mandava o texto antigo para o render.
  await descarregarTexto();
  await enfileirar('fase2', { nome: P.nome });
  $('#logEtapa').textContent = 'fase 2';
  $('#logMsg').textContent = 'Render da Fase 2 na fila.';
  irParaAba('visual');
};

$('#btnProva').onclick = async () => {
  if (P.fase1?.status !== 'aprovada') {
    $('#logMsg').textContent = 'Aprove o corte da Fase 1 antes de renderizar.';
    irParaAba('corte');
    return;
  }
  await descarregarTexto();
  await enfileirar('fase2', { nome: P.nome, qualidade: 'prova' });
  $('#logEtapa').textContent = 'prova';
  $('#logMsg').textContent = 'Render de prova (540p) na fila; aparece na aba Visual.';
  irParaAba('visual');
};

/* ---------------------------------------------------------------- ws */
const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.tipo === 'projeto' && m.projeto.nome === P?.nome) aplicar(m.projeto);
  if (m.tipo === 'lista') { listarProjetos(); desenharProjetos(); }
  if (m.tipo === 'fila') {
    desenharFila(m.estado);
    // Um trabalho terminou: recarrega o projeto aberto e a tabela.
    if (!m.estado.atual) {
      desenharProjetos();
      // Abre o projeto que acabou de ficar pronto — senão você sobe um vídeo,
      // ele processa, e a tela continua mostrando o anterior.
      const ultimo = m.estado.feitos?.at(-1);
      if (ultimo && ultimo.tipo === 'fase1' && ultimo.status === 'pronto'
          && ultimo.nome !== P?.nome && ultimo.id !== ultimoAberto) {
        ultimoAberto = ultimo.id;
        listarProjetos().then(() => {
          $('#selProjeto').value = ultimo.nome;
          abrir(ultimo.nome);
          irParaAba('corte');
        });
      } else if (P) abrir(P.nome);
    }
  }
  if (m.tipo === 'progresso') {
    $('#logEtapa').textContent = `${m.item.tipo} · ${m.item.nome}`;
    $('#logMsg').textContent = m.item.msg || '';
    $('#logBarra').style.width = `${m.item.pct || 0}%`;
    const mini = document.querySelector('#painelFila .itemFila .mini i');
    if (mini) mini.style.width = `${m.item.pct || 0}%`;
    const msg = document.querySelector('#painelFila .itemFila .msg');
    if (msg) msg.textContent = m.item.msg || '';
  }
  if (m.tipo === 'log') {
    $('#logEtapa').textContent = m.etapa || '';
    $('#logMsg').textContent = m.msg || '';
    $('#logBarra').style.width = `${m.pct || 0}%`;
  }
  if (m.tipo === 'chat-parcial' && m.nome === P?.nome) mostrarParcial(m.texto);
};

montarEstilo();
montarCor();
montarLegendaEditor({
  moverAgulha: (t) => { tlCorte.player.currentTime = t; },
  recarregar: () => P && abrir(P.nome),
});
listarProjetos();

/* ================================================================== fase 2 */

function aplicarFase2() {
  const f2 = P.fase2 || {};
  // Não pisa no que ele está digitando agora.
  if (document.activeElement !== $('#headline')) {
    $('#headline').value = f2.headline || f2.headlineSugerida || '';
  }
  $('#headlineDica').textContent = f2.headline
    ? 'headline própria' : 'sugestão a partir do HOOK — edite se quiser';

  const broll = f2.broll || [];
  $('#brollStatus').textContent = broll.length
    ? `${broll.length} imagem(ns)` : 'sem b-roll — a tela dividida cai para Limpa';
  $('#brollTira').innerHTML = broll.map((b) =>
    `<img src="/midia/${encodeURIComponent(P.nome)}/broll/${encodeURIComponent(b)}" alt="">`).join('');
  $('#trilhaStatus').textContent = f2.trilha || 'sem trilha';

  // Render de prova (540p): aparece mesmo sem o final, e o final substitui.
  const prova = f2.prova ? `/midia/${encodeURIComponent(P.nome)}/${f2.prova}?v=${encodeURIComponent(f2.provaEm || '')}` : null;
  const linkProva = $('#linkProva');
  if (linkProva) {
    linkProva.style.display = prova ? '' : 'none';
    linkProva.onclick = (e) => { e.preventDefault(); const v = tlVisual.player; v.dataset.src = prova; v.src = prova; v.play?.(); };
  }
  const pronta = f2.status === 'pronta' && f2.arquivo;
  $('#visualVazio').style.display = pronta ? 'none' : '';
  $('#visualConteudo').style.display = pronta ? '' : 'none';
  if (!pronta) return;

  const v = tlVisual.player;
  const src = `/midia/${encodeURIComponent(P.nome)}/${f2.preview || f2.arquivo}?v=${encodeURIComponent(f2.renderizadaEm || '')}`;
  ligarBaixar('baixarF2', `/midia/${encodeURIComponent(P.nome)}/${f2.arquivo}`, `${P.nome}-final.mp4`);
  if (v.dataset.src !== src) {
    v.dataset.src = src;
    v.src = src;
    // Sem isso o preview fica preto até alguém dar play: adianta um quadro.
    v.addEventListener('loadedmetadata', () => { v.currentTime = 0.05; }, { once: true });
  }

  const av = f2.avisos || [];
  $('#avisos2').style.display = av.length ? '' : 'none';
  $('#avisos2').innerHTML = av.length
    ? `<b>Avisos do último render</b><ul>${av.map((a) => `<li>${a}</li>`).join('')}</ul>` : '';

  tlVisual.desenhar();
}

$('#fBroll').onchange = async (e) => {
  if (!e.target.files.length) return;
  const fd = new FormData();
  [...e.target.files].forEach((f) => fd.append('imagens', f));
  await fetch(`/api/projeto/${encodeURIComponent(P.nome)}/broll`, { method: 'POST', body: fd });
  e.target.value = '';
  abrir(P.nome);
};

$('#fTrilha').onchange = async (e) => {
  if (!e.target.files[0]) return;
  const fd = new FormData();
  fd.append('audio', e.target.files[0]);
  await fetch(`/api/projeto/${encodeURIComponent(P.nome)}/trilha`, { method: 'POST', body: fd });
  e.target.value = '';
  abrir(P.nome);
};

$('#btnTirarTrilha').onclick = async () => {
  await fetch(`/api/projeto/${encodeURIComponent(P.nome)}/trilha`, { method: 'DELETE' });
  abrir(P.nome);
};

/* =============================================================== projetos */

async function enfileirar(tipo, dados) {
  await fetch(`/api/fila/${tipo}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(dados) });
}

const solta = $('#solta');
const EXT_ACEITAS = /\.(mov|mp4|m4v|avi|mkv|webm|mpg|mpeg|3gp)$/i;

/** Uma linha de recado dentro da caixa de arrastar — o upload não pode falhar calado. */
function recado(texto, tipo = 'ok') {
  const el = $('#recadoUp');
  el.textContent = texto;
  el.className = `recadoUp ${tipo}`;
  el.style.display = texto ? '' : 'none';
}

['dragenter', 'dragover'].forEach((ev) => solta.addEventListener(ev, (e) => {
  e.preventDefault(); solta.classList.add('sobre');
}));
['dragleave', 'drop'].forEach((ev) => solta.addEventListener(ev, (e) => {
  e.preventDefault(); solta.classList.remove('sobre');
}));
solta.addEventListener('drop', (e) => {
  const todos = [...e.dataTransfer.files];
  const bons = todos.filter((f) => EXT_ACEITAS.test(f.name));
  const ruins = todos.filter((f) => !EXT_ACEITAS.test(f.name));
  if (ruins.length) {
    recado(`Não dá para usar: ${ruins.map((f) => f.name).join(', ')}. `
      + 'Aceito .mov .mp4 .m4v .avi .mkv .webm .mpg .3gp', 'erro');
  }
  if (bons.length) subirVideos(bons);
  else if (!ruins.length) recado('Nenhum arquivo veio no arrasto.', 'erro');
});
$('#fVideos').onchange = (e) => {
  const arqs = [...e.target.files];
  e.target.value = '';
  if (arqs.length) subirVideos(arqs);
};

// XHR em vez de fetch porque só ele dá progresso de upload — e vídeo é grande.

// Botão "Baixar": o player toca o proxy leve, o arquivo completo sai por aqui.
function ligarBaixar(id, url, nome) {
  const a = document.getElementById(id);
  if (!a) return;
  a.href = url;
  a.download = nome;
  a.style.display = '';
}

async function subirVideos(arquivos) {
  // Upload em pedaços de 8 MB: cada pedaço é uma requisição curta, então o
  // proxy (Traefik, 60 s de leitura) nunca corta um vídeo grande no meio.
  const total = arquivos.reduce((s, f) => s + f.size, 0);
  const barra = $('#barraUp');
  barra.style.display = '';
  let enviadoAntes = 0;
  let enfileirados = 0;
  const falhas = [];
  const progresso = (parcial, nome) => {
    const pct = Math.min(100, ((enviadoAntes + parcial) / total) * 100);
    barra.firstElementChild.style.width = `${pct}%`;
    recado(`Enviando ${nome} — ${pct.toFixed(0)}% de ${(total / 1048576).toFixed(0)} MB`);
  };
  const putPedaco = (id, indice, blob, nome, base) => new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('PUT', `/api/upload/${id}/${indice}`);
    // Blob.slice() nao herda o tipo do arquivo: sem isto o pedaco sai sem
    // Content-Type nenhum e o parser do outro lado nao o reconhece.
    x.setRequestHeader('Content-Type', 'application/octet-stream');
    // Toda saida do XHR tem que resolver a promessa, senao um pedaco abortado
    // (aba em segundo plano, rede oscilando) trava o upload inteiro para sempre.
    x.timeout = 120000;
    x.ontimeout = () => reject(new Error(`o pedaço ${indice} passou de 2 min`));
    x.onabort = () => reject(new Error(`o pedaço ${indice} foi cancelado`));
    x.upload.onprogress = (e) => { if (e.lengthComputable) progresso(base + e.loaded, nome); };
    x.onload = () => (x.status === 200 ? resolve() : reject(new Error(`HTTP ${x.status} no pedaço ${indice}`)));
    x.onerror = () => reject(new Error(`rede caiu no pedaço ${indice}`));
    x.send(blob);
  });
  for (const f of arquivos) {
    try {
      const r0 = await fetch('/api/upload/iniciar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome: f.name, tamanho: f.size, tipo: f.type }),
      });
      if (!r0.ok) throw new Error((await r0.json().catch(() => ({}))).erro || `HTTP ${r0.status} ao iniciar`);
      const { id, tamanhoPedaco } = await r0.json();
      const n = Math.max(1, Math.ceil(f.size / tamanhoPedaco));
      for (let i = 0; i < n; i++) {
        const blob = f.slice(i * tamanhoPedaco, Math.min(f.size, (i + 1) * tamanhoPedaco));
        let tentativa = 0;
        for (;;) {
          try { await putPedaco(id, i, blob, f.name, i * tamanhoPedaco); break; } catch (e) {
            if (++tentativa >= 3) throw e;
            await new Promise((ok) => setTimeout(ok, 1500 * tentativa));
          }
        }
      }
      const r1 = await fetch(`/api/upload/${id}/finalizar`, { method: 'POST' });
      if (!r1.ok) throw new Error((await r1.json().catch(() => ({}))).erro || `HTTP ${r1.status} ao finalizar`);
      enfileirados++;
    } catch (e) {
      falhas.push(`${f.name}: ${e.message}`);
    }
    enviadoAntes += f.size;
  }
  barra.style.display = 'none';
  barra.firstElementChild.style.width = '0';
  const partes = [];
  if (enfileirados) partes.push(`${enfileirados} vídeo(s) na fila`);
  if (falhas.length) partes.push(`falhou: ${falhas.join(' · ')}`);
  recado(partes.join(' · ') || 'Nada foi enviado.', enfileirados ? 'ok' : 'erro');
  listarProjetos();
  desenharProjetos();
}

$('#btnVarrer').onclick = async () => {
  const r = await (await fetch('/api/varrer', { method: 'POST' })).json();
  recado(r.enfileirados
    ? `${r.enfileirados} vídeo(s) novo(s) da pasta de entrada entraram na fila`
    : 'Nada novo na pasta de entrada — os vídeos de lá já viraram projeto.',
  r.enfileirados ? 'ok' : 'erro');
};

$('#btnLoteFase2').onclick = async () => {
  const lista = await (await fetch('/api/projetos')).json();
  const alvos = lista.filter((p) => p.statusFase1 === 'aprovada' && p.statusFase2 !== 'pronta');
  if (!alvos.length) return void ($('#logMsg').textContent = 'nenhum projeto aprovado esperando');
  for (const p of alvos) await enfileirar('fase2', { nome: p.nome });
  $('#logMsg').textContent = `${alvos.length} render(s) na fila`;
};

/*
 * O painel mostra duas coisas diferentes: o que ainda vai rodar (atual +
 * fila) e o historico do que ja terminou (feitos). Antes as duas listas
 * saiam identicas, uma embaixo da outra, com a barra de progresso cheia nos
 * concluidos — dava toda a impressao de que os videos tinham empacado na
 * fila quando na verdade nao havia mais nada para rodar. Por isso o que
 * terminou vem separado, apagado e com ✓ no lugar da barra.
 */
function desenharFila(estado) {
  const TIPO = { fase1: 'FASE 1', fase2: 'FASE 2', refazer: 'REFAZER' };

  const pendente = (i, rodando) => `
    <div class="itemFila${rodando ? ' rodando' : ''}">
      <span class="tipo">${TIPO[i.tipo]}</span>
      <span class="nome">${i.nome}</span>
      <span class="msg">${rodando ? i.msg : 'aguardando na fila'}</span>
      <span class="mini"><i style="width:${rodando ? (i.pct || 0) : 0}%"></i></span>
    </div>`;

  const feito = (i) => `
    <div class="itemFila feito${i.status === 'erro' ? ' falhou' : ''}">
      <span class="tipo">${TIPO[i.tipo]}</span>
      <span class="nome">${i.nome}</span>
      <span class="msg">${i.status === 'erro' ? `⚠ ${i.msg}` : i.msg}</span>
      <span class="marca">${i.status === 'erro' ? '✕' : '✓'}</span>
    </div>`;

  const { atual, fila, feitos } = estado;
  const emEspera = [
    ...(atual ? [pendente(atual, true)] : []),
    ...fila.map((i) => pendente(i, false)),
  ];
  const prontos = [...feitos].reverse().map(feito);

  const blocos = [];
  blocos.push(emEspera.length
    ? emEspera.join('')
    : '<div class="sub" style="padding:.4rem 0">Nada na fila — tudo que foi enviado já terminou.</div>');
  if (prontos.length) {
    blocos.push(`<div class="tituloFeitos">JÁ TERMINARAM
      <button class="linkico" id="btnLimparFeitos">limpar</button></div>`, ...prontos);
  }
  $('#painelFila').innerHTML = blocos.join('');

  const btn = $('#btnLimparFeitos');
  if (btn) {
    btn.onclick = async () => {
      await fetch('/api/fila/feitos', { method: 'DELETE' });
      desenharFila(await (await fetch('/api/fila')).json());
    };
  }

  const pendentes = (atual ? 1 : 0) + fila.length;
  $('#contFila').textContent = pendentes || '';
  $('#chatFila').textContent = atual ? `${atual.tipo} · ${atual.msg}`.slice(0, 42)
    : (pendentes ? `${pendentes} na fila` : '');
}

async function desenharProjetos() {
  const lista = await (await fetch('/api/projetos')).json();
  const selo = (s, ok) => `<span class="selo ${ok ? 'ok' : 'espera'}">${s}</span>`;
  $('#tabelaProjetos').innerHTML = lista.length ? lista.map((p) => `
    <div class="linhaProj">
      <span class="nome" data-abrir="${p.nome}">${p.nome}</span>
      <span class="dur">${p.duracao ? `${p.duracao.toFixed(1)}s` : '—'}</span>
      ${selo(`F1 ${p.statusFase1}`, p.statusFase1 === 'aprovada')}
      ${selo(`F2 ${p.statusFase2}`, p.statusFase2 === 'pronta')}
      <span class="acoesProj">
        <button data-f2="${p.nome}" ${p.statusFase1 !== 'aprovada' ? 'disabled' : ''}>Fase 2</button>
        <button data-apagar="${p.nome}">Apagar</button>
      </span>
    </div>`).join('') : '<div class="sub" style="padding:14px 16px">Nenhum projeto ainda.</div>';

  $('#tabelaProjetos').querySelectorAll('[data-abrir]').forEach((el) => {
    el.onclick = () => {
      $('#selProjeto').value = el.dataset.abrir;
      abrir(el.dataset.abrir);
      irParaAba('corte');
    };
  });
  $('#tabelaProjetos').querySelectorAll('[data-f2]').forEach((el) => {
    el.onclick = () => enfileirar('fase2', { nome: el.dataset.f2 });
  });
  $('#tabelaProjetos').querySelectorAll('[data-apagar]').forEach((el) => {
    el.onclick = async () => {
      if (!confirm(`Apagar o projeto "${el.dataset.apagar}" e todos os arquivos dele?`)) return;
      await fetch(`/api/projeto/${encodeURIComponent(el.dataset.apagar)}`, { method: 'DELETE' });
      listarProjetos(); desenharProjetos();
    };
  });
}

fetch('/api/fila').then((r) => r.json()).then(desenharFila);
// O rodapé do chat mostra quem está respondendo: o Claude ou os comandos fixos.
let modoChat = { modo: 'comandos' };
fetch('/api/chat/modo').then((r) => r.json()).then((m) => {
  modoChat = m;
  $('#chatTexto').placeholder = m.modo === 'comandos'
    ? 'Comandos: aprovar, cor #FF5200, refazer o corte…'
    : 'Fala comigo: "corta os silêncios", "deixa a legenda amarela"…';
  if (P) desenharConversa();
});

// Clicar no contador libera mais conversa neste projeto.
$('#chatDica').onclick = async () => {
  if (modoChat.modo !== 'claude' || !P) return;
  if (!confirm(`Liberar mais ${modoChat.limite} mensagens de conversa em "${P.nome}"?`)) return;
  await fetch(`/api/projeto/${encodeURIComponent(P.nome)}/chat/zerar`, { method: 'POST' });
  abrir(P.nome);
};
desenharProjetos();

/** Guarda os campos da Fase 2 (headline, volume da trilha) no projeto. */
async function salvarFase2(patch) {
  const r = await fetch(`/api/projeto/${encodeURIComponent(P.nome)}/fase2`, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (r.ok) P.fase2 = { ...P.fase2, ...(await r.json()) };
  return r.ok;
}

/* ================================================================== chat */
/*
 * O chat lateral mostra o passo a passo que o pipeline escreveu no projeto e
 * aceita comandos. Ele NAO e um modelo de linguagem: entende um conjunto fixo
 * de frases (src/server/comandos.js) e diz quando nao entendeu.
 */

const FASE_ROTULO = {
  'aguardando-aprovacao': 'aguardando você',
  aprovada: 'corte aprovado',
  ajustar: 'para ajuste',
  editado: 'timeline editada',
};

function desenharConversa() {
  const caixa = $('#conversa');
  const msgs = P?.conversa || [];
  elParcial = null; // o innerHTML abaixo substitui tudo; a bolha parcial some com ele
  $('#chatProjeto').textContent = P?.nome || 'Edvid';
  $('#chatFase').textContent = FASE_ROTULO[P?.fase1?.status] || '';

  // Rodapé: quem responde e quanta conversa resta neste projeto.
  const dica = $('#chatDica');
  if (modoChat.modo === 'local') {
    dica.textContent = `${modoChat.modelo} · local, de graça`;
    dica.style.cursor = '';
    dica.title = 'modelo rodando na sua máquina; não custa nada';
    dica.style.color = '';
  } else if (modoChat.modo === 'claude') {
    const usadas = P?.chat?.usadas || 0;
    const restam = Math.max(0, modoChat.limite - usadas);
    dica.textContent = `fable 5.1 · ${restam}/${modoChat.limite} mensagens`;
    dica.style.cursor = 'pointer';
    dica.title = 'clique para liberar mais conversa neste projeto';
    dica.style.color = restam === 0 ? 'var(--rosa)' : '';
  } else {
    dica.textContent = 'comandos fixos · sem ponte';
    dica.style.cursor = '';
    dica.title = '';
  }

  if (!msgs.length) {
    caixa.innerHTML = '<div class="msg edvid">Sem conversa ainda. '
      + 'Rode a Fase 1 num vídeo que eu conto aqui o que fiz em cada passo.</div>';
    return;
  }

  const perto = caixa.scrollHeight - caixa.scrollTop - caixa.clientHeight < 60;
  caixa.innerHTML = msgs.map((m, i) => {
    if (m.tipo === 'acao') {
      return `<div>
        <div class="msgAcao" data-abre="${i}">
          <span class="seta">&#9656;</span>
          <span>Escreveu <b class="arq">${m.arquivo}</b>, ${m.ferramentas} ferramenta${
            m.ferramentas > 1 ? 's' : ''}</span>
          <span class="mais">+${m.mais}</span><span class="menos">-${m.menos}</span>
        </div>
        <div class="detalheAcao">${m.detalhe || ''}</div>
      </div>`;
    }
    if (m.tipo === 'tabela') {
      return `<div class="msg edvid">${m.titulo}
        <table class="tabelaCorte"><thead><tr><th>#</th><th>Beat</th><th>Fala</th></tr></thead>
        <tbody>${m.linhas.map((l) => `<tr><td class="n">${l.n}</td>
          <td class="beat" style="color:${CORES_BLOCO[l.beat] || 'inherit'}">${l.beat}</td>
          <td>“${l.fala}”</td></tr>`).join('')}</tbody></table></div>`;
    }
    return `<div class="msg ${m.quem}">${destacarArquivos(m.texto)}</div>`;
  }).join('');

  caixa.querySelectorAll('[data-abre]').forEach((el) => {
    el.onclick = () => el.classList.toggle('aberta');
  });
  if (perto) caixa.scrollTop = caixa.scrollHeight;
}

// Nomes de arquivo ganham cor, como na referência.
const destacarArquivos = (t = '') => t
  .replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
  .replace(/\b([\w-]+\.(?:mp4|mov|json|md|mp3|jpg|png))\b/g, '<span class="arq">$1</span>');

/**
 * Texto parcial do Claude chegando pelo WebSocket (`chat-parcial`), enquanto
 * ele ainda esta pensando. Mostra/atualiza uma bolha no fim de #conversa;
 * quando a resposta termina, `projeto` chega e `desenharConversa()` redesenha
 * tudo — a bolha parcial some junto (ver `elParcial = null` la em cima).
 */
function mostrarParcial(texto) {
  const caixa = $('#conversa');
  if (!elParcial) {
    elParcial = document.createElement('div');
    elParcial.className = 'msg edvid parcial';
    caixa.appendChild(elParcial);
  }
  elParcial.innerHTML = destacarArquivos(texto);
  caixa.scrollTop = caixa.scrollHeight;
}

$('#chatForm').onsubmit = async (e) => {
  e.preventDefault();
  const campo = $('#chatTexto');
  const texto = campo.value.trim();
  if (!texto || !P) return;
  campo.value = '';
  campo.disabled = true;
  try {
    const r = await fetch(`/api/projeto/${encodeURIComponent(P.nome)}/conversa`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ texto }),
    });
    if (r.ok) await abrir(P.nome);
  } finally {
    campo.disabled = false;
    campo.focus();
  }
};
