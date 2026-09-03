/**
 * Exportacao de legenda: SRT (bloco a bloco) e ASS (com karaoke `\k` por
 * palavra). Usado pela rota `GET /api/projeto/:nome/legenda.(srt|ass)` e
 * pela ferramenta de chat `exportar_legenda`.
 *
 * Modulo puro (sem `node:`), igual a `legenda-motor.js`: so monta o texto a
 * partir dos blocos do motor — quem grava em disco e quem chama (a rota ou
 * a ferramenta).
 */
import { acharLegenda } from './presets.js';
import { agruparBlocos, agrupamentoDoPreset } from './legenda-motor.js';

const SAIDA_PADRAO = { largura: 1080, altura: 1920 };

/** Palavras visiveis (clipe ativo, palavra sem `oculta`), na ordem do corte. */
function palavrasVisiveis(clipes) {
  return (clipes || [])
    .filter((c) => c.ativo !== false)
    .slice()
    .sort((a, b) => a.inicio - b.inicio)
    .flatMap((c) => (c.palavras || []).filter((p) => !p.oculta));
}

/** Agrupamento do preset, com `maxPalavras` sobrescrito por `estilo.legenda` quando presente. */
function agrupamentoEfetivo(preset, legenda) {
  const base = agrupamentoDoPreset(preset);
  return { ...base, maxPalavras: legenda?.maxPalavras ?? base.maxPalavras };
}

function blocosDoProjeto(clipes, estilo) {
  const preset = acharLegenda(estilo?.estiloLegenda);
  if (preset.modo === 'nenhum') return [];
  const palavras = palavrasVisiveis(clipes);
  if (!palavras.length) return [];
  const agrupamento = agrupamentoEfetivo(preset, estilo?.legenda);
  return agruparBlocos(palavras, { ...agrupamento, pausaMax: 0.6 });
}

function textoBloco(bloco, maiusculas) {
  const texto = bloco.linhas
    .map((linha) => linha.map((idx) => bloco.palavras[idx].texto).join(' '))
    .join('\n');
  return maiusculas ? texto.toUpperCase() : texto;
}

/* --------------------------------------------------------------------- SRT */

function tempoSrt(s) {
  const total = Math.max(0, Math.round(s * 1000));
  const h = Math.floor(total / 3600000);
  const m = Math.floor((total % 3600000) / 60000);
  const sec = Math.floor((total % 60000) / 1000);
  const ms = total % 1000;
  const p2 = (n) => String(n).padStart(2, '0');
  return `${p2(h)}:${p2(m)}:${p2(sec)},${String(ms).padStart(3, '0')}`;
}

/** Gera o SRT inteiro do projeto: um bloco do motor (`agruparBlocos`) por legenda. */
export function gerarSrt(clipes, estilo = {}) {
  const preset = acharLegenda(estilo?.estiloLegenda);
  const maiusculas = estilo?.legenda?.maiusculas ?? preset.maiusculas ?? false;
  const blocos = blocosDoProjeto(clipes, estilo);
  return blocos
    .map((b, i) => `${i + 1}\n${tempoSrt(b.inicio)} --> ${tempoSrt(b.fim)}\n${textoBloco(b, maiusculas)}\n`)
    .join('\n');
}

/* --------------------------------------------------------------------- ASS */

function tempoAss(s) {
  const total = Math.max(0, Math.round(s * 100));
  const h = Math.floor(total / 360000);
  const m = Math.floor((total % 360000) / 6000);
  const sec = Math.floor((total % 6000) / 100);
  const cs = total % 100;
  const p2 = (n) => String(n).padStart(2, '0');
  return `${h}:${p2(m)}:${p2(sec)}.${p2(cs)}`;
}

/** #RRGGBB -> cor do ASS (&HAABBGGRR, alpha 00 = opaco). Hex invalido cai em branco opaco. */
function corAss(hex) {
  const h = String(hex || '#FFFFFF').replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(h)) return '&H00FFFFFF';
  const r = h.slice(0, 2);
  const g = h.slice(2, 4);
  const b = h.slice(4, 6);
  return `&H00${b}${g}${r}`.toUpperCase();
}

/** `{` e `}` tem sentido especial no ASS (abrem tag) — nunca deixar passar do texto. */
const escaparAss = (texto) => String(texto).replace(/[{}]/g, '');

/**
 * Fonte, cor base, cor de destaque e se tem contorno — lidos do preset da
 * legenda. Aproximado, nao pixel-perfect: o ASS nao tem como reproduzir todo
 * o motor de animacao (pop, brilho, onda...), so a base + a cor da palavra
 * ativa.
 */
function estiloAproximado(preset, cor) {
  const base = preset.base ? preset.base(cor) : {};
  const ativo = preset.ativo ? preset.ativo(cor) : {};
  const fonte = String(base.fontFamily || 'Montserrat, Inter, sans-serif')
    .split(',')[0].replace(/["']/g, '').trim();
  const negrito = base.fontWeight === undefined || Number(base.fontWeight) >= 700;
  const temContorno = typeof base.textShadow === 'string' && base.textShadow.includes('px');
  return {
    fonte,
    corBase: base.color && base.color !== 'transparent' ? base.color : '#FFFFFF',
    corDestaque: ativo.color || cor || '#FFD700',
    negrito,
    contorno: temContorno ? 3 : 1,
  };
}

const ALINHAMENTO_POR_POSICAO = { baixo: 2, meio: 5, alto: 8 };

/** Gera o ASS inteiro do projeto, com karaoke `\k` (em centesimos de segundo) por palavra. */
export function gerarAss(clipes, estilo = {}, saida = SAIDA_PADRAO) {
  const preset = acharLegenda(estilo?.estiloLegenda);
  const cor = estilo?.corDestaque || '#EE7533';
  const posicao = estilo?.legenda?.posicao || preset.posicao || 'baixo';
  const escala = estilo?.legenda?.escala ?? preset.escala ?? 1;
  const maiusculas = estilo?.legenda?.maiusculas ?? preset.maiusculas ?? false;
  const {
    fonte, corBase, corDestaque, negrito, contorno,
  } = estiloAproximado(preset, cor);
  const largura = saida?.largura || SAIDA_PADRAO.largura;
  const altura = saida?.altura || SAIDA_PADRAO.altura;
  const tamanhoFonte = Math.round(altura * 0.032 * escala);
  const alinhamento = ALINHAMENTO_POR_POSICAO[posicao] || 2;

  const cabecalho = [
    '[Script Info]',
    'Title: Edvid — legenda exportada',
    'ScriptType: v4.00+',
    `PlayResX: ${largura}`,
    `PlayResY: ${altura}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, '
      + 'Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, '
      + 'Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Default,${fonte},${tamanhoFonte},${corAss(corBase)},${corAss(corDestaque)},&H00000000,&H64000000,`
      + `${negrito ? -1 : 0},0,0,0,100,100,0,0,1,${contorno},0,${alinhamento},40,40,${Math.round(altura * 0.06)},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ].join('\n');

  const blocos = blocosDoProjeto(clipes, estilo);
  const eventos = blocos.map((b) => {
    const texto = b.palavras.map((p) => {
      const cs = Math.max(1, Math.round((p.fim - p.inicio) * 100));
      const palavra = maiusculas ? p.texto.toUpperCase() : p.texto;
      return `{\\k${cs}}${escaparAss(palavra)} `;
    }).join('').trim();
    return `Dialogue: 0,${tempoAss(b.inicio)},${tempoAss(b.fim)},Default,,0,0,0,,${texto}`;
  }).join('\n');

  return `${cabecalho}\n${eventos}\n`;
}
