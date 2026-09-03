import { useMemo } from 'react';
import { acharLegenda } from '../src/shared/presets.js';
import {
  agruparBlocos, agrupamentoDoPreset, estadoEm, estiloBloco, estiloPalavra, emojiDoBloco,
} from '../src/shared/legenda-motor.js';

/**
 * Legenda: agrupa as palavras do clipe em blocos (legenda-motor.js) e
 * anima entrada do bloco e palavra corrente.
 *
 * O motor (`src/shared/legenda-motor.js`) e o mesmo que alimenta a amostra
 * animada da aba Estilo (`public/amostra-legenda.js`) — se muda aqui, muda
 * la, e essa e a razao de o card ser igual ao video "por construcao".
 *
 * `estilo.legenda` (API-2, `PUT /api/projeto/:nome/legenda`) e um override
 * OPCIONAL por cima do preset: posicao, escala (multiplica o tamanho do
 * corpo), alinhamento, maiusculas (bool — `null`/ausente cai no default do
 * preset), antecedencia (passada para `estadoEm`) e maxPalavras (passada
 * para o agrupamento). Sem `estilo.legenda`, o resultado e identico ao de
 * antes desta story.
 */
export function Legenda({ clipe, t, estilo, cor, altura }) {
  const preset = acharLegenda(estilo.estiloLegenda);
  const overrides = estilo.legenda || {};
  const palavras = clipe?.palavras;

  const blocos = useMemo(() => {
    if (preset.modo === 'nenhum' || !palavras?.length) return [];
    const agrupamento = agrupamentoDoPreset(preset);
    return agruparBlocos(palavras, {
      ...agrupamento,
      maxPalavras: overrides.maxPalavras ?? agrupamento.maxPalavras,
      pausaMax: 0.6,
    });
  }, [preset, palavras, overrides.maxPalavras]);

  if (!blocos.length) return null;

  const estado = estadoEm(blocos, t, overrides.antecedencia !== undefined ? { antecedencia: overrides.antecedencia } : undefined);
  if (!estado) return null;

  const {
    bloco, dtBloco, indiceAtiva, dtPalavra, progressoPalavra,
  } = estado;
  const escalaEfetiva = overrides.escala ?? preset.escala ?? 1;
  const corpo = Math.round(altura * 0.032 * escalaEfetiva);
  const fundoLinha = preset.fundoLinha ? preset.fundoLinha(cor) : null;
  const entrada = estiloBloco(preset, { dtBloco, cor });
  const emoji = preset.emoji ? emojiDoBloco(bloco) : null;
  // `null` volta ao default do preset — so `true`/`false` explicito muda.
  const maiusculasEfetivo = (overrides.maiusculas === undefined || overrides.maiusculas === null)
    ? preset.maiusculas : overrides.maiusculas;

  // `fundoLinha` (faixa, bolha, moldura) precisa hugar so o texto, entao vira
  // um wrapper `inline-block` dentro do container — que continua largo (8% a
  // 92%) e centralizado, so ele que da o tamanho da caixa.
  const envolver = (filhos) => (fundoLinha
    ? <span style={{ display: 'inline-block', ...fundoLinha }}>{filhos}</span>
    : filhos);

  const palavraSpan = (idx, comEspaco) => {
    const w = bloco.palavras[idx];
    const estadoPalavra = idx < indiceAtiva ? 'passada' : idx > indiceAtiva ? 'futura' : 'ativa';
    const ehAtiva = estadoPalavra === 'ativa';
    const dtP = ehAtiva ? dtPalavra : 0;
    const progresso = ehAtiva ? progressoPalavra : (estadoPalavra === 'passada' ? 1 : 0);
    const espaco = comEspaco ? ' ' : '';

    // 'onda' anima letra por letra, defasada — so faz sentido pra palavra
    // que esta soando agora (as outras nao tem um `dt` corrente).
    if (ehAtiva && preset.ativa === 'onda') {
      return (
        <span key={idx}>
          {espaco}
          {[...w.texto].map((letra, li) => (
            <span
              key={li}
              style={estiloPalavra(preset, {
                estado: estadoPalavra, destaque: w.destaque, dtPalavra: dtP, progresso, cor, indiceLetra: li,
              })}
            >
              {letra}
            </span>
          ))}
        </span>
      );
    }

    const est = estiloPalavra(preset, {
      estado: estadoPalavra, destaque: w.destaque, dtPalavra: dtP, progresso, cor,
    });
    // O separador fica FORA do span animado: `pop`/`bounce`/`caixa`/`tremor`
    // viram `display: inline-block`, e um espaco de abertura dentro de um
    // inline-block e engolido pelo navegador — o vao some entre as palavras.
    return <span key={idx}>{espaco}<span style={est}>{w.texto}</span></span>;
  };

  const conteudo = bloco.linhas.map((linha, li) => (
    <span key={li} style={{ display: 'block' }}>
      {linha.map((idx, k) => palavraSpan(idx, k > 0))}
    </span>
  ));

  return (
    <div style={{
      ...caixaLegenda(altura, preset, overrides),
      fontSize: corpo,
      ...preset.base(cor),
      ...entrada,
      textTransform: maiusculasEfetivo ? 'uppercase' : 'none',
    }}
    >
      {envolver(<>{conteudo}{emoji ? ` ${emoji}` : ''}</>)}
    </div>
  );
}

const caixaLegenda = (altura, preset = {}, overrides = {}) => {
  const posicao = overrides.posicao || preset.posicao || 'baixo';
  const posEstilo = posicao === 'meio'
    ? { top: '50%', transform: 'translateY(-50%)' }
    : posicao === 'alto'
      ? { top: altura * 0.30 }
      : { bottom: altura * 0.17 };
  const alinhamento = overrides.alinhamento === 'esquerda' ? 'left' : 'center';

  return {
    position: 'absolute',
    left: '8%', right: '8%',
    textAlign: alinhamento,
    lineHeight: 1.25,
    fontFamily: 'Inter, -apple-system, Helvetica, Arial, sans-serif',
    ...posEstilo,
  };
};
