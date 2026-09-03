import { AbsoluteFill, Img, OffthreadVideo, staticFile, interpolate } from 'remotion';

/**
 * Intro opcional antes do primeiro clipe (`projeto.intro`, catalogo em
 * `src/shared/efeitos.js`). So decide o visual de imagem/video; a headline por
 * cima (`intro.headline`) e responsabilidade de quem chama (`Reel.jsx`), que
 * passa o node pronto em `children` — a logica de estilo da headline nao
 * muda, so o tempo em que ela aparece.
 *
 * `t` aqui e o tempo desde o inicio da intro (0 no primeiro quadro dela).
 */
export function Intro({ intro, t, largura, altura, children }) {
  if (!intro?.arquivo) return null;
  const duracao = intro.duracao || 2.5;

  const conteudo = intro.tipo === 'video'
    ? (
      <OffthreadVideo src={staticFile(intro.arquivo)}
        style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
    )
    : <ImagemAnimada arquivo={intro.arquivo} t={t} duracao={duracao} animacao={intro.animacao} />;

  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      {conteudo}
      {children}
    </AbsoluteFill>
  );
}

function ImagemAnimada({ arquivo, t, duracao, animacao = 'zoom-lento' }) {
  let estilo = { width: '100%', height: '100%', objectFit: 'cover' };

  if (animacao === 'fade') {
    const opacidade = interpolate(t, [0, 0.5], [0, 1], { extrapolateRight: 'clamp' });
    estilo = { ...estilo, opacity: opacidade };
  } else if (animacao === 'slide') {
    const x = interpolate(t, [0, 0.6], [40, 0], { extrapolateRight: 'clamp', easing: (x) => x });
    estilo = { ...estilo, transform: `translateX(${x}px)` };
  } else {
    // zoom-lento: 1,00 -> 1,08 ao longo da intro inteira.
    const escala = interpolate(t, [0, duracao], [1.0, 1.08], { extrapolateRight: 'clamp' });
    estilo = { ...estilo, transform: `scale(${escala})` };
  }

  return (
    <div style={{ width: '100%', height: '100%', overflow: 'hidden' }}>
      <Img src={staticFile(arquivo)} style={estilo} />
    </div>
  );
}
