import { AbsoluteFill, OffthreadVideo, Freeze, staticFile } from 'remotion';

/**
 * Camadas e transformacoes dos efeitos por projeto/clipe (`estilo.efeitos` e
 * `fase1.clipes[].efeitos`, catalogo em `src/shared/efeitos.js`).
 *
 * `Camada` e a peca central: em vez de um `<OffthreadVideo>` continuo (que so
 * funciona se a linha do tempo de apresentacao for identica a do arquivo
 * fonte), todo quadro pede explicitamente qual quadro do `fase1-corte.mp4`
 * mostrar (`sourceFrame`), via `<Freeze>`. Isso deixa o congelamento de CTA
 * (`congelar`) e a sobreposicao das transicoes (`Transicao.jsx`) simples: as
 * duas coisas so precisam saber, para cada quadro, qual `sourceFrame` pedir —
 * nao ha diferenca entre "tocando normal" e "congelado", so muda a formula.
 */
export function Camada({
  arquivo, sourceFrame, escala = 1, deslocamento = { x: 0, y: 0 }, shake = { x: 0, y: 0 },
  blurFundo = false,
}) {
  const quadro = Math.max(0, Math.round(sourceFrame));
  const video = (
    <OffthreadVideo
      src={staticFile(arquivo)}
      style={{ width: '100%', height: '100%', objectFit: blurFundo ? 'contain' : 'cover' }}
    />
  );

  return (
    <div style={{
      width: '100%', height: '100%', overflow: 'hidden',
      transform: `scale(${escala}) translate(${deslocamento.x + shake.x}px, ${deslocamento.y + shake.y}px)`,
      transformOrigin: 'center center',
    }}>
      <Freeze frame={quadro}>
        <div style={{ width: '100%', height: '100%', position: 'relative' }}>
          {blurFundo && (
            <div style={{
              position: 'absolute', inset: 0, transform: 'scale(1.3)',
              filter: 'blur(40px) brightness(.55)',
            }}>
              <OffthreadVideo src={staticFile(arquivo)}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            </div>
          )}
          <div style={{ position: 'absolute', inset: 0 }}>{video}</div>
        </div>
      </Freeze>
    </div>
  );
}

/** Tremor de camera: translacao com ruido senoidal de baixa frequencia. Puro — mesmo `t`, mesmo tremor. */
export function deslocamentoShake(t, intensidade = 0) {
  if (!intensidade) return { x: 0, y: 0 };
  const i = Math.min(1, intensidade);
  return {
    x: (Math.sin(t * 9.1) * 3 + Math.sin(t * 17.3 + 1.7) * 1.4) * i,
    y: (Math.cos(t * 7.7 + 0.6) * 3 + Math.sin(t * 13.1) * 1.2) * i,
  };
}

/** Grao de filme: ruido SVG (feTurbulence) por cima do video, opacidade proporcional a intensidade. */
export function Grao({ intensidade = 0, frame = 0 }) {
  if (!intensidade) return null;
  const opacidade = Math.min(1, intensidade) * 0.5;
  return (
    <AbsoluteFill style={{ opacity: opacidade, mixBlendMode: 'overlay', pointerEvents: 'none' }}>
      <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0 }}>
        <filter id="edvid-grao">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves={2}
            seed={(frame % 8) + 1} stitchTiles="stitch" result="ruido" />
          <feColorMatrix in="ruido" type="matrix"
            values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 .7 0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#edvid-grao)" />
      </svg>
    </AbsoluteFill>
  );
}

/** Vinheta: gradiente radial escuro nas bordas. */
export function Vinheta({ intensidade = 0 }) {
  if (!intensidade) return null;
  const alpha = Math.min(1, intensidade) * 0.75;
  return (
    <AbsoluteFill style={{
      pointerEvents: 'none',
      background: `radial-gradient(ellipse at center, rgba(0,0,0,0) 42%, rgba(0,0,0,${alpha}) 100%)`,
    }} />
  );
}

/** Letterbox: barras pretas em cima e embaixo para a area de video ficar em 2,35:1. */
export function Letterbox({ largura, altura }) {
  const alturaVisivel = Math.min(altura, largura / 2.35);
  const barra = Math.max(0, (altura - alturaVisivel) / 2);
  if (barra <= 0) return null;
  return (
    <>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: barra, background: '#000' }} />
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: barra, background: '#000' }} />
    </>
  );
}

/** Barra de progresso: linha na cor de destaque, cresce com o progresso 0..1 do video inteiro. */
export function BarraProgresso({ progresso = 0, posicao = 'base', cor = '#EE7533' }) {
  const p = Math.min(1, Math.max(0, progresso));
  const posEstilo = posicao === 'topo' ? { top: 0 } : { bottom: 0 };
  return (
    <div style={{
      position: 'absolute', left: 0, ...posEstilo, height: 6, width: `${p * 100}%`,
      background: cor,
    }} />
  );
}
