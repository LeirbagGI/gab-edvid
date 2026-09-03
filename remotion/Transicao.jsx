import { AbsoluteFill, interpolate } from 'remotion';

/**
 * Easing "back out" (leve estouro antes de assentar) — o `Easing` do Remotion
 * nao tem, e o zoom-punch pede exatamente isso.
 */
function backOut(t) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const x = t - 1;
  return 1 + c3 * x ** 3 + c1 * x ** 2;
}

/**
 * Aplica a mascara temporal de uma transicao a um par de camadas ja prontas
 * (`anterior`: o clipe que esta saindo, congelado no ultimo quadro pelo
 * chamador; `atual`: o clipe que esta entrando, tocando normal). `progresso`
 * vai de 0 (inicio da janela, ainda no clipe anterior) a 1 (fim da janela, ja
 * no clipe atual) — ver a janela centrada no corte em `src/shared/efeitos.js`.
 */
export function Transicao({ tipo, progresso, anterior, atual, largura, altura }) {
  const p = Math.min(1, Math.max(0, progresso));

  switch (tipo) {
    case 'crossfade':
      return (
        <AbsoluteFill>
          <AbsoluteFill>{anterior}</AbsoluteFill>
          <AbsoluteFill style={{ opacity: p }}>{atual}</AbsoluteFill>
        </AbsoluteFill>
      );

    case 'dip-preto':
    case 'dip-branco': {
      const cor = tipo === 'dip-preto' ? '#000' : '#fff';
      const opacidadeCor = interpolate(p, [0, 0.5, 1], [0, 1, 0]);
      return (
        <AbsoluteFill>
          <AbsoluteFill>{p < 0.5 ? anterior : atual}</AbsoluteFill>
          <AbsoluteFill style={{ backgroundColor: cor, opacity: opacidadeCor }} />
        </AbsoluteFill>
      );
    }

    case 'zoom-punch': {
      const escala = interpolate(p, [0, 1], [1.25, 1], { easing: backOut });
      const opacidade = interpolate(p, [0, 0.35], [0, 1], { extrapolateRight: 'clamp' });
      return (
        <AbsoluteFill>
          <AbsoluteFill>{anterior}</AbsoluteFill>
          <AbsoluteFill style={{ opacity: opacidade, transform: `scale(${escala})`, transformOrigin: 'center center' }}>
            {atual}
          </AbsoluteFill>
        </AbsoluteFill>
      );
    }

    case 'whip-esquerda':
    case 'whip-direita': {
      const lado = tipo === 'whip-esquerda' ? -1 : 1;
      const saidaX = interpolate(p, [0, 1], [0, lado * largura]);
      const entradaX = interpolate(p, [0, 1], [-lado * largura, 0]);
      const blur = interpolate(p, [0, 0.5, 1], [0, 22, 0]);
      return (
        <AbsoluteFill>
          <AbsoluteFill style={{ transform: `translateX(${saidaX}px)`, filter: `blur(${blur}px)` }}>
            {anterior}
          </AbsoluteFill>
          <AbsoluteFill style={{ transform: `translateX(${entradaX}px)`, filter: `blur(${blur}px)` }}>
            {atual}
          </AbsoluteFill>
        </AbsoluteFill>
      );
    }

    case 'slide-cima':
    case 'slide-baixo': {
      const lado = tipo === 'slide-cima' ? -1 : 1;
      const saidaY = interpolate(p, [0, 1], [0, lado * altura]);
      const entradaY = interpolate(p, [0, 1], [-lado * altura, 0]);
      return (
        <AbsoluteFill>
          <AbsoluteFill style={{ transform: `translateY(${saidaY}px)` }}>{anterior}</AbsoluteFill>
          <AbsoluteFill style={{ transform: `translateY(${entradaY}px)` }}>{atual}</AbsoluteFill>
        </AbsoluteFill>
      );
    }

    case 'blur': {
      const blurAnterior = interpolate(p, [0, 1], [0, 34]);
      const opacidadeAnterior = interpolate(p, [0, 1], [1, 0]);
      const opacidadeAtual = interpolate(p, [0, 1], [0, 1]);
      return (
        <AbsoluteFill>
          <AbsoluteFill style={{ filter: `blur(${blurAnterior}px)`, opacity: opacidadeAnterior }}>
            {anterior}
          </AbsoluteFill>
          <AbsoluteFill style={{ opacity: opacidadeAtual }}>{atual}</AbsoluteFill>
        </AbsoluteFill>
      );
    }

    case 'glitch': {
      // Tres fatias horizontais, cada uma com uma copia deslocada e tingida
      // (vermelho/ciano/amarelo) em `mixBlendMode: screen` — separacao de
      // canal RGB por duplicata, nao por filtro de cor de verdade. Ruido
      // deterministico (seno do indice e do progresso), nunca Math.random.
      const opacidadeGeral = interpolate(p, [0, 0.15, 0.85, 1], [0, 1, 1, 0]);
      const cores = ['#ff2a6d', '#38D6D2', '#F5C518'];
      return (
        <AbsoluteFill>
          <AbsoluteFill>{p < 0.5 ? anterior : atual}</AbsoluteFill>
          {[0, 1, 2].map((i) => {
            const ruido = Math.sin((i + 1) * 12.9898 + p * 43.7);
            const deslocamento = ruido * largura * 0.045 * (1 - Math.abs(p - 0.5) * 2);
            return (
              <AbsoluteFill key={i} style={{
                clipPath: `inset(${(i * 100) / 3}% 0 ${((2 - i) * 100) / 3}% 0)`,
                transform: `translateX(${deslocamento}px)`,
                opacity: opacidadeGeral * 0.85,
                mixBlendMode: 'screen',
                filter: `drop-shadow(${deslocamento >= 0 ? 2 : -2}px 0 0 ${cores[i]})`,
              }}>
                {i % 2 === 0 ? atual : anterior}
              </AbsoluteFill>
            );
          })}
        </AbsoluteFill>
      );
    }

    default:
      return <AbsoluteFill>{atual}</AbsoluteFill>;
  }
}
