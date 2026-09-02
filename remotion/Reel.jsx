import {
  AbsoluteFill, OffthreadVideo, Audio, Img, staticFile,
  useCurrentFrame, useVideoConfig, interpolate, Easing,
} from 'remotion';
import { acharHeadline, acharLegenda } from '../src/shared/presets.js';

/* ------------------------------------------------------------------ ajudas */

/** Qual clipe esta no ar neste segundo, e a que altura dele estamos (0..1). */
function clipeAtual(clipes, t) {
  for (const c of clipes) {
    if (t >= c.inicio && t < c.fim) {
      return { clipe: c, progresso: (t - c.inicio) / Math.max(0.001, c.fim - c.inicio) };
    }
  }
  const ultimo = clipes[clipes.length - 1];
  return { clipe: ultimo, progresso: 1 };
}

/** Escala do zoom: lenta durante o clipe, com um empurrao logo apos o corte. */
function escala(clipe, progresso, t, elementos) {
  let s = 1;
  if (elementos.automacaoZoomIn && clipe) {
    s *= interpolate(progresso, [0, 1], [1.0, 1.06], { extrapolateRight: 'clamp' });
  }
  if (elementos.zoomInOutNosCortes && clipe) {
    // 0,35 s de acomodacao logo depois do corte: entra 4% maior e assenta.
    const desdeOCorte = t - clipe.inicio;
    const alterna = (clipe.indice % 2 === 0) ? 1.04 : 0.97;
    s *= interpolate(desdeOCorte, [0, 0.35], [alterna, 1], {
      extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic),
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

/* ------------------------------------------------------------------ legenda */

function Legenda({ clipe, t, estilo, cor, altura }) {
  const preset = acharLegenda(estilo.estiloLegenda);
  if (preset.modo === 'nenhum' || !clipe?.palavras?.length) return null;

  const base = preset.base(cor);
  const ativo = preset.ativo(cor);
  const corpo = Math.round(altura * 0.032 * (preset.escala || 1));

  if (preset.modo === 'palavra') {
    const p = clipe.palavras.find((w) => t >= w.inicio && t < w.fim);
    if (!p) return null;
    return (
      <div style={{ ...caixaLegenda(altura), fontSize: corpo, ...base }}>{p.texto}</div>
    );
  }

  // Modo frase: mostra uma janela de palavras e pinta a que esta soando.
  // A mesma janela do preset alimenta a amostra animada da aba Estilo.
  const idx = clipe.palavras.findIndex((w) => t >= w.inicio && t < w.fim);
  if (idx < 0) return null;
  const janela = preset.janela || 4;
  const inicio = Math.floor(idx / janela) * janela;
  const pedaco = clipe.palavras.slice(inicio, inicio + janela);

  return (
    <div style={{ ...caixaLegenda(altura), fontSize: corpo, ...base }}>
      {pedaco.map((w, i) => {
        const soando = t >= w.inicio && t < w.fim;
        return (
          <span key={`${w.inicio}-${i}`} style={soando ? ativo : undefined}>
            {w.texto}{i < pedaco.length - 1 ? ' ' : ''}
          </span>
        );
      })}
    </div>
  );
}

const caixaLegenda = (altura) => ({
  position: 'absolute',
  left: '8%', right: '8%',
  bottom: altura * 0.17,
  textAlign: 'center',
  lineHeight: 1.25,
  fontFamily: 'Inter, -apple-system, Helvetica, Arial, sans-serif',
});

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

  const clipes = (projeto.fase1.clipes || [])
    .filter((c) => c.ativo !== false)
    .map((c, i) => ({ ...c, indice: i }));

  const { clipe, progresso } = clipeAtual(clipes, t);
  const s = escala(clipe, progresso, t, el);
  const d = deslocamento(clipe, progresso, el.movimentoTracking);

  // Flash branco curto no primeiro quadro depois de cada corte.
  const desdeOCorte = clipe ? t - clipe.inicio : 99;
  const flash = el.flashNaTransicao && clipe && clipe.indice > 0
    ? interpolate(desdeOCorte, [0, 0.13], [0.55, 0], { extrapolateRight: 'clamp' })
    : 0;

  // A headline fica no ar enquanto durar o bloco HOOK.
  const fimDoHook = clipes.filter((c) => c.bloco === 'HOOK').at(-1)?.fim ?? 0;
  const aparecer = interpolate(t, [0.15, 0.55, fimDoHook - 0.4, fimDoHook], [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  const dividida = est.tipoEdicao === 'tela-dividida' || est.tipoEdicao === 'tela-dividida-2';
  const imagemEmCima = est.tipoEdicao === 'tela-dividida';
  // Uma imagem por clipe, em rodizio; sem imagens a tela dividida vira limpa.
  const broll = f2.broll || [];
  const imagem = dividida && broll.length ? broll[clipe.indice % broll.length] : null;
  const partido = dividida && imagem;

  const alturaVideo = partido ? height * 0.58 : height;

  const camada = (
    <div style={{
      width: '100%', height: '100%', overflow: 'hidden',
      transform: `scale(${s}) translate(${d.x}px, ${d.y}px)`,
      transformOrigin: 'center center',
    }}>
      <OffthreadVideo
        src={staticFile(projeto.fase1.arquivo)}
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
      />
    </div>
  );

  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      {partido ? (
        <AbsoluteFill style={{ flexDirection: 'column' }}>
          {imagemEmCima && (
            <div style={{ height: height - alturaVideo, overflow: 'hidden' }}>
              <Img src={staticFile(`broll/${imagem}`)}
                   style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            </div>
          )}
          <div style={{ height: alturaVideo, overflow: 'hidden' }}>{camada}</div>
          {!imagemEmCima && (
            <div style={{ height: height - alturaVideo, overflow: 'hidden' }}>
              <Img src={staticFile(`broll/${imagem}`)}
                   style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            </div>
          )}
        </AbsoluteFill>
      ) : (
        <AbsoluteFill>{camada}</AbsoluteFill>
      )}

      {el.trilhaSonoraComIA && f2.trilha && (
        <Audio src={staticFile(f2.trilha)} volume={f2.volumeTrilha ?? 0.09} loop />
      )}

      <Headline texto={f2.headline} estilo={est} cor={cor} altura={height} aparecer={aparecer} />
      <Legenda clipe={clipe} t={t} estilo={est} cor={cor} altura={height} />

      {flash > 0 && (
        <AbsoluteFill style={{ backgroundColor: '#fff', opacity: flash }} />
      )}
    </AbsoluteFill>
  );
};
