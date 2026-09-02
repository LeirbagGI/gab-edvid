import { acharLegenda } from '../src/shared/presets.js';

/**
 * Legenda: karaoke por frase, por palavra, ou acumulando conforme a fala.
 *
 * O contrato do preset (`src/shared/presets.js`) e o mesmo que alimenta a
 * amostra animada da aba Estilo (`public/amostra-legenda.js`) — se muda aqui,
 * muda la, e essa e a razao de tudo derivar do mesmo objeto de preset.
 */
export function Legenda({ clipe, t, estilo, cor, altura }) {
  const preset = acharLegenda(estilo.estiloLegenda);
  if (preset.modo === 'nenhum' || !clipe?.palavras?.length) return null;

  const base = preset.base(cor);
  const ativo = preset.ativo(cor);
  const passado = preset.passado ? preset.passado(cor) : {};
  const futuro = preset.futuro ? preset.futuro(cor) : {};
  const corpo = Math.round(altura * 0.032 * (preset.escala || 1));
  const fundoLinha = preset.fundoLinha ? preset.fundoLinha(cor) : null;

  // `fundoLinha` (faixa, bolha) precisa hugar so o texto, entao vira um
  // wrapper `inline-block` dentro do container — que continua largo (8% a
  // 92%) e centralizado, so ele que da o tamanho da caixa.
  const envolver = (filhos) => (fundoLinha
    ? <span style={{ display: 'inline-block', ...fundoLinha }}>{filhos}</span>
    : filhos);

  const estiloPalavra = (w, dentroDaAtiva) => {
    if (dentroDaAtiva) {
      return preset.transformAtivo
        ? { ...ativo, display: 'inline-block', transform: preset.transformAtivo }
        : ativo;
    }
    if (t < w.inicio) {
      // No modo acumula a palavra que ainda nao foi dita fica invisivel, mas
      // continua ocupando o lugar dela — e assim que o "surge conforme fala"
      // nao empurra o resto da janela.
      return preset.modo === 'acumula' ? { visibility: 'hidden' } : futuro;
    }
    return passado;
  };

  if (preset.modo === 'palavra') {
    const p = clipe.palavras.find((w) => t >= w.inicio && t < w.fim);
    if (!p) return null;
    return (
      <div style={{ ...caixaLegenda(altura, preset), fontSize: corpo, ...base }}>
        {envolver(p.texto)}
      </div>
    );
  }

  // Modo frase ou acumula: mostra uma janela de palavras e pinta a que esta
  // soando. A mesma janela do preset alimenta a amostra animada da aba Estilo.
  const idx = clipe.palavras.findIndex((w) => t >= w.inicio && t < w.fim);
  if (idx < 0) return null;
  const janela = preset.janela || 4;
  const inicio = Math.floor(idx / janela) * janela;
  const pedaco = clipe.palavras.slice(inicio, inicio + janela);

  return (
    <div style={{ ...caixaLegenda(altura, preset), fontSize: corpo, ...base }}>
      {envolver(pedaco.map((w, i) => {
        const soando = t >= w.inicio && t < w.fim;
        return (
          <span key={`${w.inicio}-${i}`} style={estiloPalavra(w, soando)}>
            {w.texto}{i < pedaco.length - 1 ? ' ' : ''}
          </span>
        );
      }))}
    </div>
  );
}

const caixaLegenda = (altura, preset = {}) => {
  const posicao = preset.posicao || 'baixo';
  const posEstilo = posicao === 'meio'
    ? { top: '50%', transform: 'translateY(-50%)' }
    : posicao === 'alto'
      ? { top: altura * 0.30 }
      : { bottom: altura * 0.17 };

  return {
    position: 'absolute',
    left: '8%', right: '8%',
    textAlign: 'center',
    lineHeight: 1.25,
    fontFamily: 'Inter, -apple-system, Helvetica, Arial, sans-serif',
    ...(preset.maiusculas ? { textTransform: 'uppercase' } : null),
    ...posEstilo,
  };
};
