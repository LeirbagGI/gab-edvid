/**
 * Correcao de cor da Fase 1 (F1): LUTs .cube e ajustes manuais, montados numa
 * cadeia de filtros do ffmpeg. Compartilhado — sem `node:` aqui, porque este
 * arquivo pode ser servido tanto para o servidor (fase1/render.js) quanto
 * para o navegador (aba Cor, F2), igual a `presets.js`.
 */

/** Faixa valida de cada ajuste manual, para validar e para a UI (F2) desenhar sliders. */
export const FAIXAS_AJUSTES = {
  exposicao: { min: -2, max: 2, label: 'Exposição (EV)' },
  contraste: { min: 0.5, max: 2, label: 'Contraste' },
  saturacao: { min: 0, max: 3, label: 'Saturação' },
  temperatura: { min: -100, max: 100, label: 'Temperatura' },
  tint: { min: -100, max: 100, label: 'Tint (verde/magenta)' },
  brilho: { min: -0.5, max: 0.5, label: 'Brilho' },
  gama: { min: 0.5, max: 2, label: 'Gama' },
  vinheta: { min: 0, max: 1, label: 'Vinheta' },
};

/** Valor neutro de cada ajuste — o que nao muda nada no filtro. */
export const AJUSTES_PADRAO = {
  exposicao: 0,
  contraste: 1,
  saturacao: 1,
  temperatura: 0,
  tint: 0,
  brilho: 0,
  gama: 1,
  vinheta: 0,
};

/** As 12 LUTs geradas em `luts/` (ver `luts/README.md` e `luts/gerar.js`). */
export const LUTS = [
  { id: 'neutro', nome: 'Neutro', descricao: 'Identidade, sem alteração — referência.', arquivo: 'neutro.cube' },
  { id: 'quente', nome: 'Quente', descricao: 'Ganho no vermelho, corte leve no azul.', arquivo: 'quente.cube' },
  { id: 'frio', nome: 'Frio', descricao: 'O inverso da Quente: corte no vermelho, ganho no azul.', arquivo: 'frio.cube' },
  { id: 'teal-orange', nome: 'Teal & Orange', descricao: 'Sombras para ciano, luzes para laranja, por luminância.', arquivo: 'teal-orange.cube' },
  { id: 'contraste-suave', nome: 'Contraste suave', descricao: 'Curva S leve.', arquivo: 'contraste-suave.cube' },
  { id: 'contraste-forte', nome: 'Contraste forte', descricao: 'Curva S forte.', arquivo: 'contraste-forte.cube' },
  { id: 'desbotado', nome: 'Desbotado', descricao: 'Preto elevado, branco reduzido, saturação −20%.', arquivo: 'desbotado.cube' },
  { id: 'vintage', nome: 'Vintage', descricao: 'Desbotado + quente + leve verde nas sombras.', arquivo: 'vintage.cube' },
  { id: 'pb', nome: 'Preto e branco', descricao: 'Dessatura total.', arquivo: 'pb.cube' },
  { id: 'pb-contraste', nome: 'P&B contrastado', descricao: 'Dessatura + curva S forte.', arquivo: 'pb-contraste.cube' },
  { id: 'vivido', nome: 'Vívido', descricao: 'Saturação +25%, curva S leve.', arquivo: 'vivido.cube' },
  { id: 'noite', nome: 'Noite', descricao: 'Azul nas sombras, luzes neutras, exposição −10%.', arquivo: 'noite.cube' },
];

/** Cor "sem correcao": e o que todo projeto novo grava em `projeto.cor`. */
export function corPadrao() {
  return { lut: null, intensidade: 1, ajustes: { ...AJUSTES_PADRAO } };
}

/**
 * Escapa um caminho de arquivo para entrar em `file='<caminho>'` dentro da
 * sintaxe de filtro do ffmpeg — que tem seu proprio parser, independente do
 * shell. Envolvido em aspas simples, so a aspas simples precisa de escape
 * (fecha, escapa, reabre); dois-pontos dentro das aspas ja ficam literais.
 */
export function escaparCaminhoLut(caminho) {
  return String(caminho)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "'\\''");
}

/** Junta pasta + arquivo sem `node:path` (formato POSIX, o unico usado aqui). */
function juntarCaminho(pasta, arquivo) {
  return `${String(pasta).replace(/\/+$/, '')}/${String(arquivo).replace(/^\/+/, '')}`;
}

/**
 * Valida um objeto de cor (ou so um pedaco dele, como `{ ajustes: {...} }`,
 * do jeito que as ferramentas do chat mandam). Nao aceita campo desconhecido
 * nem valor fora da faixa documentada em FAIXAS_AJUSTES.
 */
export function validarCor(obj) {
  const erros = [];
  const c = obj || {};

  if (Object.prototype.hasOwnProperty.call(c, 'lut') && c.lut !== null && c.lut !== undefined) {
    if (!LUTS.some((l) => l.id === c.lut)) erros.push(`LUT desconhecida: "${c.lut}"`);
  }

  if (Object.prototype.hasOwnProperty.call(c, 'intensidade') && c.intensidade !== undefined) {
    // Mistura com o original (blend) fica fora desta story — so 0 (desligada) ou 1 (cheia).
    if (c.intensidade !== 0 && c.intensidade !== 1) {
      erros.push('intensidade so aceita 0 ou 1 nesta fase (sem mistura parcial ainda)');
    }
  }

  if (Object.prototype.hasOwnProperty.call(c, 'ajustes') && c.ajustes !== undefined) {
    if (typeof c.ajustes !== 'object' || c.ajustes === null || Array.isArray(c.ajustes)) {
      erros.push('ajustes precisa ser um objeto');
    } else {
      for (const [chave, valor] of Object.entries(c.ajustes)) {
        const faixa = FAIXAS_AJUSTES[chave];
        if (!faixa) { erros.push(`ajuste desconhecido: "${chave}"`); continue; }
        if (typeof valor !== 'number' || Number.isNaN(valor)) {
          erros.push(`${chave} precisa ser numero, veio ${JSON.stringify(valor)}`);
          continue;
        }
        if (valor < faixa.min || valor > faixa.max) {
          erros.push(`${chave} fora da faixa ${faixa.min}..${faixa.max}: ${valor}`);
        }
      }
    }
  }

  return { ok: erros.length === 0, erros };
}

/**
 * Monta a cadeia de filtros do ffmpeg para a cor do projeto. Devolve string
 * vazia se `cor` estiver inteira no padrao (sem LUT, ajustes neutros) — nesse
 * caso o chamador nem insere o filtro no filter_complex.
 *
 * Ordem (cada etapa so entra se mudar algo): lut3d -> eq (brilho/contraste/
 * saturacao/gama) -> colortemperature -> colorbalance (tint) -> exposure ->
 * vignette. `pastaLuts` e a pasta onde os .cube vivem (LUTS_DIR em
 * fase1/render.js).
 */
export function montarFiltroCor(cor, { pastaLuts } = {}) {
  const c = cor || corPadrao();
  const ajustes = { ...AJUSTES_PADRAO, ...(c.ajustes || {}) };
  const intensidade = c.intensidade ?? 1;
  const partes = [];

  if (c.lut && intensidade > 0) {
    const item = LUTS.find((l) => l.id === c.lut);
    if (item) {
      const caminho = juntarCaminho(pastaLuts, item.arquivo);
      partes.push(`lut3d=file='${escaparCaminhoLut(caminho)}':interp=tetrahedral`);
    }
  }

  const eqMudou = ['brilho', 'contraste', 'saturacao', 'gama']
    .some((k) => ajustes[k] !== AJUSTES_PADRAO[k]);
  if (eqMudou) {
    partes.push(`eq=brightness=${ajustes.brilho}:contrast=${ajustes.contraste}`
      + `:saturation=${ajustes.saturacao}:gamma=${ajustes.gama}`);
  }

  if (ajustes.temperatura !== AJUSTES_PADRAO.temperatura) {
    // 1000..40000K e a faixa do filtro; -100..100 vira +-3000K em torno de 6500K (luz do dia).
    const kelvin = 6500 + ajustes.temperatura * 30;
    partes.push(`colortemperature=temperature=${kelvin}`);
  }

  if (ajustes.tint !== AJUSTES_PADRAO.tint) {
    // tint positivo = mais magenta (reduz verde nos midtones); negativo = mais verde.
    const gm = Number((-ajustes.tint / 100).toFixed(4));
    partes.push(`colorbalance=gm=${gm}`);
  }

  if (ajustes.exposicao !== AJUSTES_PADRAO.exposicao) {
    partes.push(`exposure=exposure=${ajustes.exposicao}`);
  }

  if (ajustes.vinheta !== AJUSTES_PADRAO.vinheta && ajustes.vinheta > 0) {
    // vinheta 0..1 -> angulo PI/x, com x = 2/vinheta (vinheta=1 -> PI/2, o maximo pratico).
    const x = Number((2 / ajustes.vinheta).toFixed(4));
    partes.push(`vignette=angle=PI/${x}`);
  }

  return partes.join(',');
}
