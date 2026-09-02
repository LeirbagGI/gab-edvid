import fs from 'node:fs';
import path from 'node:path';
import { PROJETOS, SAIDA } from '../shared/config.js';
import { ffprobe } from '../shared/exec.js';
import { extrairWav, transcreverPalavras, detectarSilencios } from './transcrever.js';
import { corteOrganico, classificarBlocos } from './corte.js';
import { renderizarCorte, gerarMiniaturas, gerarPicos } from './render.js';
import { narra, acao, tabelaDoCorte, seg } from '../shared/conversa.js';

const ESTADO = 'projeto.json';
const CORTE_HOOK = 4;

/** "2 respiros, 1 falso comeco" — para a narracao ficar concreta. */
function resumoMotivos(descartados) {
  const conta = {};
  for (const d of descartados) for (const m of d.motivos) conta[m] = (conta[m] || 0) + 1;
  const nome = { respiro: 'respiro', muleta: 'muleta', 'false-start': 'falso começo',
    repeticao: 'repetição', 'tomada-refeita': 'tomada refeita' };
  return Object.entries(conta)
    .map(([m, n]) => `${n} ${nome[m] || m}${n > 1 ? 's' : ''}`)
    .join(', ');
}

export function caminhoProjeto(nome) {
  return path.join(PROJETOS, nome);
}

export function carregar(nome) {
  const arq = path.join(caminhoProjeto(nome), ESTADO);
  if (!fs.existsSync(arq)) return null;
  return JSON.parse(fs.readFileSync(arq, 'utf8'));
}

export function salvar(projeto) {
  const pasta = caminhoProjeto(projeto.nome);
  fs.mkdirSync(pasta, { recursive: true });
  fs.writeFileSync(path.join(pasta, ESTADO), JSON.stringify(projeto, null, 2));
  return projeto;
}

/**
 * Nome de projeto a partir do arquivo de origem, sem colidir com um existente.
 * Serve tanto para a CLI quanto para o upload pela web.
 */
export function nomeLivre(arquivo) {
  const base = path.basename(arquivo).replace(/\.(mov|mp4|m4v)$/i, '');
  const limpo = base.replace(/[^\w\-.\s]+/g, '').trim().slice(0, 48) || 'projeto';
  let nome = limpo;
  let i = 2;
  while (fs.existsSync(caminhoProjeto(nome))) nome = `${limpo} ${i++}`;
  return nome;
}

export function listar() {
  if (!fs.existsSync(PROJETOS)) return [];
  return fs.readdirSync(PROJETOS)
    .filter((d) => fs.existsSync(path.join(PROJETOS, d, ESTADO)))
    .map((d) => carregar(d))
    .sort((a, b) => (b.criadoEm || '').localeCompare(a.criadoEm || ''));
}

/**
 * Refaz o render da Fase 1 usando a timeline como ela esta no projeto.json —
 * respeitando clipes desligados e bordas ajustadas a mao no preview.
 */
export async function refazerCorte(nome, { log = () => {} } = {}) {
  const projeto = carregar(nome);
  if (!projeto) throw new Error(`Projeto "${nome}" nao encontrado.`);

  const ativos = projeto.fase1.clipes.filter((c) => c.ativo !== false);
  if (!ativos.length) throw new Error('Todos os clipes estao desligados.');

  const pasta = caminhoProjeto(nome);
  const arquivoCorte = path.join(pasta, 'fase1-corte.mp4');
  const duracao = ativos.reduce((s, c) => s + c.duracao, 0);

  log({ etapa: 'render', msg: `Refazendo o corte com ${ativos.length} clipes` });
  await renderizarCorte(projeto.origem.caminho, ativos, arquivoCorte, {
    onProgresso: (s) => log({ etapa: 'render', msg: 'Renderizando', pct: (s / duracao) * 100 }),
  });

  log({ etapa: 'waveform', msg: 'Redesenhando a waveform' });
  projeto.fase1.picos = await gerarPicos(arquivoCorte);

  // Reposiciona os clipes ativos na linha do tempo nova.
  let t = 0;
  const mantidos = ativos.map((c) => {
    // As palavras ja estao na linha do tempo do corte anterior, nao na origem.
    const desloc = t - c.inicio;
    const clipe = {
      ...c,
      inicio: Number(t.toFixed(3)),
      fim: Number((t + c.duracao).toFixed(3)),
      palavras: c.palavras.map((p) => ({
        ...p,
        inicio: Number((p.inicio + desloc).toFixed(3)),
        fim: Number((p.fim + desloc).toFixed(3)),
      })),
    };
    t += c.duracao;
    return clipe;
  });

  // Tirar clipes muda as proporcoes da narrativa, entao os blocos sao refeitos.
  // Quem foi trocado a mao no preview (blocoManual) fica como esta.
  const reclassificados = classificarBlocos(mantidos)
    .map((c, i) => (mantidos[i].blocoManual ? mantidos[i] : c));

  projeto.fase1.clipes = [
    ...reclassificados,
    ...projeto.fase1.clipes.filter((c) => c.ativo === false),
  ];
  projeto.fase1.duracao = Number(duracao.toFixed(2));
  projeto.fase1.status = 'aguardando-aprovacao';
  salvar(projeto);

  const desligados = projeto.fase1.clipes.filter((c) => c.ativo === false).length;
  narra(projeto, `Refiz o corte com ${reclassificados.length} clipes`
    + `${desligados ? ` (${desligados} desligado${desligados > 1 ? 's' : ''} por voce)` : ''}. `
    + `Ficou em ${seg(duracao)} e reclassifiquei os beats, porque tirar clipe muda as proporções.`);
  tabelaDoCorte(projeto);
  salvar(projeto);

  log({ etapa: 'pronto', msg: `Corte refeito (${duracao.toFixed(1)}s). Aprova?` });
  return projeto;
}

/** Estilo padrao da Fase 2, igual as opcoes da aba Estilo. */
export function estiloPadrao() {
  return {
    tipoEdicao: 'limpa',            // limpa | tela-dividida | tela-dividida-2
    corDestaque: '#EE7533',         // laranja da identidade GI
    estiloHeadline: 'caixa-branca',
    estiloLegenda: 'karaoke',
    elementos: {
      movimentoTracking: false,
      automacaoZoomIn: true,
      zoomInOutNosCortes: true,
      trilhaSonoraComIA: true,
      flashNaTransicao: false,
    },
    observacoes: '',
  };
}

/**
 * Cria o projeto e roda a Fase 1 inteira: probe -> wav -> transcricao ->
 * corte organico -> render -> miniaturas -> waveform.
 * `log` recebe { etapa, msg, pct } para a CLI e o preview mostrarem progresso.
 */
export async function rodarFase1(videoOrigem, nome, { log = () => {} } = {}) {
  const pasta = caminhoProjeto(nome);
  const trabalho = path.join(pasta, 'trabalho');
  const thumbs = path.join(pasta, 'thumbs');
  fs.mkdirSync(trabalho, { recursive: true });
  fs.mkdirSync(thumbs, { recursive: true });

  log({ etapa: 'origem', msg: 'Lendo o arquivo de origem' });
  const info = await ffprobe(videoOrigem);
  if (!info.temAudio) throw new Error('O video de origem nao tem faixa de audio.');

  log({ etapa: 'audio', msg: 'Extraindo audio para transcricao' });
  const wav = await extrairWav(videoOrigem, path.join(trabalho, 'origem.wav'));

  log({ etapa: 'transcricao', msg: 'Transcrevendo com Whisper (palavra a palavra)' });
  const palavras = await transcreverPalavras(wav, trabalho, {
    onLinha: (l) => {
      const m = l.match(/\[(\d+):(\d+):([\d.]+)\s*-->/);
      if (m) {
        const s = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
        log({ etapa: 'transcricao', msg: 'Transcrevendo', pct: Math.min(99, (s / info.duracao) * 100) });
      }
    },
  });

  log({ etapa: 'silencio', msg: 'Medindo os silencios do audio' });
  const silencios = await detectarSilencios(wav);

  log({ etapa: 'corte', msg: 'Montando o corte organico' });
  const { clipes, descartados } = corteOrganico(palavras, info.duracao, silencios);
  if (!clipes.length) throw new Error('O corte organico nao encontrou fala aproveitavel.');

  const arquivoCorte = path.join(pasta, 'fase1-corte.mp4');
  const duracaoFinal = clipes.reduce((s, c) => s + c.duracao, 0);

  log({ etapa: 'render', msg: 'Renderizando o corte' });
  await renderizarCorte(videoOrigem, clipes, arquivoCorte, {
    onProgresso: (s) => log({ etapa: 'render', msg: 'Renderizando', pct: (s / duracaoFinal) * 100 }),
  });

  log({ etapa: 'thumbs', msg: 'Gerando miniaturas da timeline' });
  await gerarMiniaturas(videoOrigem, clipes, thumbs);

  log({ etapa: 'waveform', msg: 'Desenhando a waveform' });
  const picos = await gerarPicos(arquivoCorte);

  // Recalcula o tempo de cada clipe ja na linha do tempo do corte (nao da origem).
  let t = 0;
  const naTimeline = clipes.map((c) => {
    const inicio = t;
    t += c.duracao;
    const desloc = inicio - c.origemInicio;
    return {
      ...c,
      inicio: Number(inicio.toFixed(3)),
      fim: Number(t.toFixed(3)),
      palavras: c.palavras.map((p) => ({
        ...p,
        inicio: Number((p.inicio + desloc).toFixed(3)),
        fim: Number((p.fim + desloc).toFixed(3)),
      })),
    };
  });

  const projeto = {
    nome,
    criadoEm: new Date().toISOString(),
    origem: {
      caminho: videoOrigem,
      arquivo: path.basename(videoOrigem),
      duracao: info.duracao,
      largura: info.largura,
      altura: info.altura,
      fps: info.fps,
      tamanho: info.tamanho,
    },
    saida: { ...SAIDA },
    fase1: {
      status: 'aguardando-aprovacao',
      arquivo: path.relative(pasta, arquivoCorte),
      duracao: Number(duracaoFinal.toFixed(2)),
      clipes: naTimeline,
      descartados,
      picos,
    },
    estilo: estiloPadrao(),
    fase2: { status: 'nao-iniciada' },
  };

  // O passo a passo que aparece no chat lateral.
  const removidos = descartados.length;
  narra(projeto, `Peguei ${path.basename(videoOrigem)} — ${info.duracao.toFixed(0)}s de bruto, `
    + `${info.largura}×${info.altura}. Transcrevi palavra a palavra e montei o corte orgânico.`);
  const tempoSilencio = silencios.reduce((t, s) => t + (s.fim - s.inicio), 0);
  if (tempoSilencio > 0.5) {
    narra(projeto, `Achei ${silencios.length} silêncio(s) somando ${seg(tempoSilencio)} `
      + 'e cortei fora — é isso que dá o ritmo.');
  } else {
    // Dizer isso importa: sem o aviso, parece que o corte por silêncio falhou.
    narra(projeto, 'Não achei silêncio para cortar: você fala sem pausa e o ambiente '
      + 'tem ruído acima do limiar. Cortei pelo fim de frase e por duração, '
      + `resultado ${naTimeline.length} clipes.`);
  }
  narra(projeto, removidos
    ? `Tirei ${removidos} trecho${removidos > 1 ? 's' : ''}: `
      + `${resumoMotivos(descartados)}. Níveis equilibrados (+${CORTE_HOOK} dB no HOOK), loudness em −14 LUFS.`
    : 'Não achei respiro, muleta nem tomada repetida para cortar — a fala já estava limpa. '
      + `Níveis equilibrados (+${CORTE_HOOK} dB no HOOK), loudness em −14 LUFS.`);
  acao(projeto, {
    arquivo: 'projeto.json', ferramentas: 2, mais: naTimeline.length, menos: removidos,
    detalhe: `${naTimeline.length} clipes na timeline, ${removidos} descartados, `
      + `${palavras.length} palavras transcritas.`,
  });
  narra(projeto, `Fase 1 pronta — ${path.basename(arquivoCorte)}, ${seg(duracaoFinal)}, `
    + `${SAIDA.largura}×${SAIDA.altura} ${SAIDA.fps}fps. Está tocando no preview.`);
  tabelaDoCorte(projeto);
  narra(projeto, 'O corte está no player. Fase 1 pronta — aguardando sua aprovação. '
    + 'Aprova aí em cima, ou me diz aqui o que quer mudar.');

  salvar(projeto);
  log({
    etapa: 'pronto',
    msg: `Fase 1 — corte organico pronto (${duracaoFinal.toFixed(1)}s). Aprova?`,
  });
  return projeto;
}
