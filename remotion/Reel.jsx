import {
  AbsoluteFill, Audio, Img, staticFile,
  useCurrentFrame, useVideoConfig, interpolate, Easing,
} from 'remotion';
import { acharHeadline } from '../src/shared/presets.js';
import { transicaoPadrao, acharTransicao } from '../src/shared/efeitos.js';
import { Legenda } from './Legenda.jsx';
import {
  Camada, deslocamentoShake, Grao, Vinheta, Letterbox, BarraProgresso,
} from './Efeitos.jsx';
import { Transicao } from './Transicao.jsx';
import { Intro } from './Intro.jsx';

/* ------------------------------------------------------------------ ajudas */

/**
 * Clipes ativos com a linha do tempo VISUAL (apresentacao): `inicioVisual` /
 * `fimVisual` / `duracaoVisual` esticados pelo `congelar` de cada um. `inicio`
 * / `fim` continuam sendo a posicao original no `fase1-corte.mp4` — servem so
 * para achar qual quadro do arquivo mostrar, nunca para saber "quando" algo
 * aparece na tela.
 */
function linhaVisual(clipes) {
  let tv = 0;
  return clipes.map((c) => {
    const congelar = Math.max(0, c.efeitos?.congelar || 0);
    const inicioVisual = tv;
    const duracaoVisual = c.duracao + congelar;
    tv += duracaoVisual;
    return { ...c, congelar, inicioVisual, fimVisual: tv, duracaoVisual };
  });
}

/**
 * Acha o clipe visual ativo em `tp` (tempo desde o fim da intro) e o quadro
 * do `fase1-corte.mp4` que deve aparecer — tocando normal, ou congelado no
 * ultimo quadro se `tp` ja passou da duracao original do clipe (a extensao
 * do `congelar`).
 */
function fonteNoTempo(clipesVisuais, tp, fps) {
  for (const c of clipesVisuais) {
    if (tp >= c.inicioVisual && tp < c.fimVisual) {
      const congelado = tp >= c.inicioVisual + c.duracao;
      const progresso = Math.min(1, Math.max(0, (tp - c.inicioVisual) / Math.max(0.001, c.duracao)));
      const sourceFrame = congelado
        ? Math.round(c.fim * fps) - 1
        : Math.round((c.inicio + (tp - c.inicioVisual)) * fps);
      return { clipe: c, progresso, sourceFrame, congelado };
    }
  }
  const ultimo = clipesVisuais[clipesVisuais.length - 1];
  if (!ultimo) return { clipe: null, progresso: 0, sourceFrame: 0, congelado: false };
  return {
    clipe: ultimo, progresso: 1, sourceFrame: Math.round(ultimo.fim * fps) - 1, congelado: true,
  };
}

/** Escala do zoom: lenta durante o clipe, com um empurrao logo apos o corte. `tp` e presentacao. */
function escala(clipe, progresso, tp, elementos) {
  let s = 1;
  if (elementos.automacaoZoomIn && clipe) {
    s *= interpolate(progresso, [0, 1], [1.0, 1.06], { extrapolateRight: 'clamp' });
  }
  if (elementos.zoomInOutNosCortes && clipe) {
    // 0,35 s de acomodacao logo depois do corte: entra 4% maior e assenta.
    const desdeOCorte = tp - clipe.inicioVisual;
    const alterna = (clipe.indice % 2 === 0) ? 1.04 : 0.97;
    s *= interpolate(desdeOCorte, [0, 0.35], [alterna, 1], {
      extrapolateRight: 'clamp', extrapolateLeft: 'clamp', easing: Easing.out(Easing.cubic),
    });
  }
  return s;
}

/** Deriva lentamente na horizontal, o "tracking" do painel de elementos. */
function deslocamento(clipe, progresso, ligado) {
  if (!ligado || !clipe) return { x: 0, y: 0 };
  const lado = clipe.indice % 2 === 0 ? 1 : -1;
  return {
    x: interpolate(progresso, [0, 1], [-14 * lado, 14 * lado]),
    y: interpolate(progresso, [0, 1], [6, -6]),
  };
}

/** Efeitos efetivos no instante: os do projeto, com o que o clipe ativo sobrescreve. */
function efeitosEfetivos(estiloEfeitos, clipe) {
  return { ...(estiloEfeitos || {}), ...(clipe?.efeitos || {}) };
}

/* ----------------------------------------------------------------- headline */

function Headline({ texto, estilo, cor, altura, aparecer }) {
  if (!texto) return null;
  const preset = acharHeadline(estilo.estiloHeadline);
  const est = preset.estilo(cor);
  const linhas = texto.split('\n');

  return (
    <div style={{
      position: 'absolute', left: '7%', right: '7%', top: altura * 0.13,
      textAlign: 'center', fontSize: Math.round(altura * 0.036), lineHeight: 1.22,
      fontFamily: 'Inter, -apple-system, Helvetica, Arial, sans-serif',
      opacity: aparecer, transform: `translateY(${(1 - aparecer) * -18}px)`,
    }}>
      <span style={{ display: 'inline-block', ...est }}>
        {linhas.map((l, i) => (
          <span key={i} style={{
            display: 'block',
            color: preset.corSegundaLinha && i === 1 ? cor : undefined,
          }}>{l}</span>
        ))}
      </span>
    </div>
  );
}

/* --------------------------------------------------------------- composicao */

export const Reel = ({ projeto }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = frame / fps;

  const est = projeto.estilo || {};
  const el = est.elementos || {};
  const cor = est.corDestaque || '#EE7533';
  const f2 = projeto.fase2 || {};

  // A intro (se houver) desloca todo o resto — clipes, legenda, headline —
  // em `intro.duracao`. `tp` e o tempo desde o fim da intro; negativo durante ela.
  const intro = projeto.intro || null;
  const introDuracao = intro ? (intro.duracao || 2.5) : 0;
  const tp = t - introDuracao;

  const clipesBase = (projeto.fase1.clipes || [])
    .filter((c) => c.ativo !== false)
    .map((c, i) => ({ ...c, indice: i }));
  const clipes = linhaVisual(clipesBase);

  const transicaoGlobal = transicaoPadrao(est);
  const transicaoDoClipe = (clipe) => {
    if (!clipe?.transicao?.tipo) return transicaoGlobal;
    const def = acharTransicao(clipe.transicao.tipo);
    return { tipo: def.id, duracao: clipe.transicao.duracao ?? def.duracao };
  };

  // Janela de transicao ativa (se houver): sobreposicao centrada no corte
  // entre clipes[i-1] e clipes[i]. `corte` nunca teve sobreposicao; `flash`
  // continua com o comportamento de sempre (mais abaixo), sem entrar aqui.
  let transicaoAtiva = null;
  for (let i = 1; i < clipes.length; i++) {
    const atual = clipes[i];
    const def = transicaoDoClipe(atual);
    if (def.tipo === 'corte' || def.tipo === 'flash' || def.duracao <= 0) continue;
    const meio = def.duracao / 2;
    const desde = tp - atual.inicioVisual;
    if (desde >= -meio && desde < meio) {
      transicaoAtiva = { def, progresso: (desde + meio) / def.duracao, anterior: clipes[i - 1], atual };
      break;
    }
  }

  // Clipe "dono" da tela agora — governa legenda, efeito por clipe e o flash.
  const fonteInfo = fonteNoTempo(clipes, tp, fps);
  const clipeAtivo = fonteInfo.clipe;
  const efeitosAtivos = efeitosEfetivos(est.efeitos, clipeAtivo);

  const camadaDe = (info) => {
    if (!info?.clipe) return null;
    const ef = efeitosEfetivos(est.efeitos, info.clipe);
    return (
      <Camada
        arquivo={projeto.fase1.arquivo}
        sourceFrame={info.sourceFrame}
        escala={escala(info.clipe, info.progresso, info.tp, el)}
        deslocamento={deslocamento(info.clipe, info.progresso, el.movimentoTracking)}
        shake={deslocamentoShake(t, ef.shake || 0)}
        blurFundo={Boolean(ef.blurFundo)}
      />
    );
  };

  let conteudoVideo = null;
  if (tp >= 0) {
    if (transicaoAtiva) {
      const { anterior, atual } = transicaoAtiva;
      // Anterior: congelado no ultimo quadro real dele (assentado, progresso 1).
      const infoAnterior = {
        clipe: anterior,
        sourceFrame: Math.round(anterior.fim * fps) - 1,
        progresso: 1,
        tp: anterior.inicioVisual + 999,
      };
      // Atual: toca normal a partir do proprio inicio; antes do corte ainda
      // "nao comecou" — mostra o primeiro quadro dele, parado.
      const localAtual = Math.max(0, tp - atual.inicioVisual);
      const infoAtual = {
        clipe: atual,
        sourceFrame: Math.round(atual.inicio * fps) + Math.round(localAtual * fps),
        progresso: Math.min(1, localAtual / Math.max(0.001, atual.duracao)),
        tp,
      };
      conteudoVideo = (
        <Transicao
          tipo={transicaoAtiva.def.tipo} progresso={transicaoAtiva.progresso}
          anterior={camadaDe(infoAnterior)} atual={camadaDe(infoAtual)}
          largura={width} altura={height}
        />
      );
    } else if (clipeAtivo) {
      conteudoVideo = camadaDe({ clipe: clipeAtivo, sourceFrame: fonteInfo.sourceFrame, progresso: fonteInfo.progresso, tp });
    }
  }

  // Progresso do video inteiro (intro + clipes), para a barra de progresso.
  const duracaoClipes = clipes.length ? clipes[clipes.length - 1].fimVisual : 0;
  const duracaoTotal = introDuracao + duracaoClipes;
  const progressoGlobal = duracaoTotal > 0 ? Math.min(1, Math.max(0, t / duracaoTotal)) : 0;

  // Headline: entra 0,15->0,55s, sai 0,4s antes do fim do bloco HOOK. Se a
  // intro tem headline (`intro.headline`), esse tempo conta desde o inicio do
  // video (a headline aparece ja na intro); senao, so depois que ela acaba.
  const fimDoHookVisual = clipes.filter((c) => c.bloco === 'HOOK').at(-1)?.fimVisual ?? 0;
  const headlineNaIntro = Boolean(intro?.headline);
  const tempoHeadline = headlineNaIntro ? t : tp;
  const fimHeadline = headlineNaIntro ? introDuracao + fimDoHookVisual : fimDoHookVisual;
  const aparecer = interpolate(
    tempoHeadline, [0.15, 0.55, fimHeadline - 0.4, fimHeadline], [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );

  // Flash branco curto no primeiro quadro depois de cada corte — igual ao de
  // sempre (compatibilidade); so entra quando a transicao efetiva e 'flash'.
  const flashDef = transicaoDoClipe(clipeAtivo);
  const desdeOCorte = clipeAtivo ? tp - clipeAtivo.inicioVisual : 99;
  const flash = flashDef.tipo === 'flash' && clipeAtivo && clipeAtivo.indice > 0
    ? interpolate(desdeOCorte, [0, flashDef.duracao], [0.55, 0], {
      extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
    })
    : 0;

  const dividida = est.tipoEdicao === 'tela-dividida' || est.tipoEdicao === 'tela-dividida-2';
  const imagemEmCima = est.tipoEdicao === 'tela-dividida';
  // Uma imagem por clipe, em rodizio; sem imagens a tela dividida vira limpa.
  const broll = f2.broll || [];
  const imagem = dividida && broll.length && clipeAtivo ? broll[clipeAtivo.indice % broll.length] : null;
  const partido = dividida && imagem && conteudoVideo != null;

  const alturaVideo = partido ? height * 0.58 : height;

  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      {intro && t < introDuracao && (
        <Intro intro={intro} t={t} largura={width} altura={height} />
      )}

      {tp >= 0 && (
        <>
          {partido ? (
            <AbsoluteFill style={{ flexDirection: 'column' }}>
              {imagemEmCima && (
                <div style={{ height: height - alturaVideo, overflow: 'hidden' }}>
                  <Img src={staticFile(`broll/${imagem}`)}
                       style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
              )}
              <div style={{ height: alturaVideo, overflow: 'hidden' }}>{conteudoVideo}</div>
              {!imagemEmCima && (
                <div style={{ height: height - alturaVideo, overflow: 'hidden' }}>
                  <Img src={staticFile(`broll/${imagem}`)}
                       style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
              )}
            </AbsoluteFill>
          ) : (
            <AbsoluteFill>{conteudoVideo}</AbsoluteFill>
          )}

          {el.trilhaSonoraComIA && f2.trilha && (
            <Audio src={staticFile(f2.trilha)} volume={f2.volumeTrilha ?? 0.09} loop />
          )}

          <Grao intensidade={efeitosAtivos.grao || 0} frame={frame} />
          <Vinheta intensidade={efeitosAtivos.vinheta || 0} />
          {efeitosAtivos.letterbox && <Letterbox largura={width} altura={height} />}
          {efeitosAtivos.barraProgresso && (
            <BarraProgresso
              progresso={progressoGlobal}
              posicao={efeitosAtivos.barraProgresso.posicao}
              cor={cor}
            />
          )}

          <Legenda clipe={clipeAtivo} t={fonteInfo.sourceFrame / fps} estilo={est} cor={cor} altura={height} />

          {flash > 0 && (
            <AbsoluteFill style={{ backgroundColor: '#fff', opacity: flash }} />
          )}
        </>
      )}

      <Headline texto={f2.headline} estilo={est} cor={cor} altura={height} aparecer={aparecer} />
    </AbsoluteFill>
  );
};
