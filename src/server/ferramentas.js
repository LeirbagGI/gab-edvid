import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { HEADLINES, LEGENDAS, TIPOS_EDICAO, ELEMENTOS, CORES } from '../shared/presets.js';
import { tabelaDoCorte, seg } from '../shared/conversa.js';
import { LUTS, AJUSTES_PADRAO, corPadrao, validarCor } from '../shared/cor.js';
import { caminhoProjeto } from '../fase1/projeto.js';

/**
 * As ferramentas do chat — o que o Claude (via MCP), o Ollama e os comandos
 * fixos podem de fato fazer no projeto.
 *
 * Extraido de cerebro.js: mcp.js registra cada uma como tool MCP, local.js
 * chama a mesma `executar` no laco do Ollama. Uma unica lista, uma unica
 * implementacao — nao existe caminho paralelo.
 */

const lista = (arr) => arr.map((x) => x.id).join(' | ');

export const FERRAMENTAS = [
  {
    name: 'aprovar_corte',
    description: 'Aprova o corte da Fase 1. Só depois disso a Fase 2 pode rodar.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'pedir_ajuste',
    description: 'Marca a Fase 1 como "precisa de ajuste", quando o corte não está bom.',
    input_schema: {
      type: 'object',
      properties: { motivo: { type: 'string', description: 'O que está ruim.' } },
      required: [],
    },
  },
  {
    name: 'refazer_corte',
    description: 'Renderiza de novo o corte da Fase 1 com a timeline como está agora '
      + '(clipes desligados, bordas aparadas). Use depois de mexer em clipes.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'renderizar_fase2',
    description: 'Renderiza o vídeo final: headline, legenda, zoom, trilha. '
      + 'Exige a Fase 1 aprovada.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'mudar_estilo',
    description: 'Muda as escolhas de estilo da Fase 2. Só mande os campos que o usuário pediu.',
    input_schema: {
      type: 'object',
      properties: {
        tipoEdicao: { type: 'string', enum: TIPOS_EDICAO.map((t) => t.id) },
        corDestaque: { type: 'string', description: 'Hex (#FF5200) OU um nome: '
          + Object.keys(CORES).join(', ') + '. Prefira o nome — não invente hex.' },
        estiloHeadline: { type: 'string', enum: HEADLINES.map((h) => h.id) },
        estiloLegenda: { type: 'string', enum: LEGENDAS.map((l) => l.id) },
        headline: { type: 'string', description: 'Texto da headline. \\n quebra a linha.' },
      },
      required: [],
    },
  },
  {
    name: 'ligar_elemento',
    description: `Liga ou desliga um elemento da edição. Ids: ${lista(ELEMENTOS)}`,
    input_schema: {
      type: 'object',
      properties: {
        elemento: { type: 'string', enum: ELEMENTOS.map((e) => e.id) },
        ligado: { type: 'boolean' },
      },
      required: ['elemento', 'ligado'],
    },
  },
  {
    name: 'mexer_clipe',
    description: 'Liga ou desliga um clipe da timeline. Desligado, ele sai do corte '
      + 'quando você chamar refazer_corte.',
    input_schema: {
      type: 'object',
      properties: {
        clipe: { type: 'string', description: 'Id do clipe, ex: c3' },
        ativo: { type: 'boolean' },
      },
      required: ['clipe', 'ativo'],
    },
  },
  {
    name: 'mostrar_corte',
    description: 'Mostra a tabela do corte no chat: número, beat e fala de cada clipe.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'aplicar_lut',
    description: `Aplica (ou tira) uma LUT de cor no corte. Ids: ${lista(LUTS)} | nenhum. `
      + 'Refaça o corte depois para ver o resultado.',
    input_schema: {
      type: 'object',
      properties: { lut: { type: 'string', enum: [...LUTS.map((l) => l.id), 'nenhum'] } },
      required: ['lut'],
    },
  },
  {
    name: 'ajustar_cor',
    description: 'Ajusta exposição, contraste, saturação, temperatura, tint, brilho, gama ou '
      + 'vinheta do corte. Só manda os campos que o usuário pediu.',
    input_schema: {
      type: 'object',
      properties: {
        exposicao: { type: 'number', description: 'EV, faixa -2 a 2' },
        contraste: { type: 'number', description: 'faixa 0.5 a 2' },
        saturacao: { type: 'number', description: 'faixa 0 a 3' },
        temperatura: { type: 'number', description: 'faixa -100 a 100' },
        tint: { type: 'number', description: 'verde/magenta, faixa -100 a 100' },
        brilho: { type: 'number', description: 'faixa -0.5 a 0.5' },
        gama: { type: 'number', description: 'faixa 0.5 a 2' },
        vinheta: { type: 'number', description: 'faixa 0 a 1' },
      },
      required: [],
    },
  },
  {
    name: 'zerar_cor',
    description: 'Zera a correção de cor do corte: tira a LUT e volta todos os ajustes ao padrão.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'baixar_para_projeto',
    description: 'Baixa um arquivo gerado (Magnific: imagem, vídeo, áudio) e salva na pasta do '
      + 'projeto. Use depois de creations_get, com a URL de verdade — nunca invente URL.',
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL do arquivo gerado, de creations_get.' },
        tipo: { type: 'string', enum: ['broll', 'trilha', 'intro', 'sfx', 'voz'] },
        nome: { type: 'string', description: 'Nome do arquivo, sem extensão. Opcional.' },
      },
      required: ['url', 'tipo'],
    },
  },
];

/**
 * Executa a ferramenta e devolve o que contar de volta para o modelo.
 *
 * Todas as ferramentas de hoje sao sincronas: `executar` fica de proposito
 * uma função comum (não `async`), porque `local.js` (Ollama) usa o retorno
 * direto, sem await, e virar `async` faria toda chamada devolver uma
 * Promise ali — quebrando o conteudo da resposta em TODAS as ferramentas, nao
 * so na nova. `baixar_para_projeto` e a unica async (baixa arquivo de
 * verdade); quando `fazer` devolve uma Promise, so registra no registro
 * depois que ela resolve — quem chama (mcp.js) precisa dar `await` no
 * retorno, o que funciona igual para string ou Promise<string>.
 */
export function executar(nome, entrada, projeto, trabalhos, registro = []) {
  const r = fazer(nome, entrada, projeto, trabalhos);
  if (r && typeof r.then === 'function') {
    return r.then((resolvido) => {
      registro.push({ ferramenta: nome, resultado: resolvido });
      return resolvido;
    });
  }
  registro.push({ ferramenta: nome, resultado: r });
  return r;
}

function fazer(nome, entrada, projeto, trabalhos) {
  switch (nome) {
    case 'aprovar_corte':
      if (!projeto.fase1?.clipes?.length) return 'Ainda não existe corte.';
      projeto.fase1.status = 'aprovada';
      return `Corte aprovado, ${seg(projeto.fase1.duracao)}.`;

    case 'pedir_ajuste':
      projeto.fase1.status = 'ajustar';
      projeto.fase1.observacao = entrada.motivo || '';
      return 'Marcado para ajuste.';

    case 'refazer_corte':
      trabalhos.push({ tipo: 'refazer', nome: projeto.nome });
      return 'Refazer o corte entrou na fila.';

    case 'renderizar_fase2':
      if (projeto.fase1?.status !== 'aprovada') return 'A Fase 1 ainda não foi aprovada.';
      trabalhos.push({ tipo: 'fase2', nome: projeto.nome });
      return 'Render da Fase 2 entrou na fila.';

    case 'mudar_estilo': {
      const mudou = [];
      for (const campo of ['tipoEdicao', 'estiloHeadline', 'estiloLegenda']) {
        if (entrada[campo]) { projeto.estilo[campo] = entrada[campo]; mudou.push(`${campo}=${entrada[campo]}`); }
      }
      if (entrada.corDestaque) {
        // Nome vira a cor da tabela; hex passa direto. Nada mais é aceito.
        const pedida = String(entrada.corDestaque).trim();
        const porNome = CORES[pedida.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')];
        const hex = porNome || (/^#[0-9a-f]{6}$/i.test(pedida) ? pedida.toUpperCase() : null);
        if (!hex) return `Não conheço a cor "${pedida}". Use um nome (${Object.keys(CORES).join(', ')}) ou um hex #RRGGBB.`;
        projeto.estilo.corDestaque = hex;
        mudou.push(`cor=${hex}`);
      }
      if (typeof entrada.headline === 'string') {
        projeto.fase2 = { ...projeto.fase2, headline: entrada.headline };
        mudou.push('headline');
      }
      return mudou.length ? `Mudei: ${mudou.join(', ')}.` : 'Nada mudou.';
    }

    case 'ligar_elemento':
      projeto.estilo.elementos[entrada.elemento] = entrada.ligado;
      return `${entrada.elemento}: ${entrada.ligado ? 'ligado' : 'desligado'}.`;

    case 'mexer_clipe': {
      const c = projeto.fase1?.clipes?.find((x) => x.id === entrada.clipe);
      if (!c) return `Não existe o clipe ${entrada.clipe}.`;
      c.ativo = entrada.ativo;
      projeto.fase1.status = 'editado';
      return `Clipe ${entrada.clipe} ${entrada.ativo ? 'religado' : 'desligado'}: "${c.texto.slice(0, 50)}".`;
    }

    case 'mostrar_corte':
      if (!projeto.fase1?.clipes?.length) return 'Ainda não há corte.';
      tabelaDoCorte(projeto);
      return 'Tabela mostrada no chat.';

    case 'aplicar_lut': {
      projeto.cor = projeto.cor || corPadrao();
      const pedida = entrada.lut === 'nenhum' ? null : entrada.lut;
      if (pedida !== null && !LUTS.some((l) => l.id === pedida)) {
        return `Não conheço a LUT "${entrada.lut}".`;
      }
      projeto.cor.lut = pedida;
      if (pedida !== null) projeto.cor.intensidade = 1;
      trabalhos.push({ tipo: 'refazer', nome: projeto.nome });
      const nomeLut = pedida ? LUTS.find((l) => l.id === pedida).nome : 'nenhuma';
      return `LUT ${nomeLut} aplicada; refaça o corte para ver.`;
    }

    case 'ajustar_cor': {
      projeto.cor = projeto.cor || corPadrao();
      const patch = {};
      for (const campo of Object.keys(AJUSTES_PADRAO)) {
        if (typeof entrada[campo] === 'number') patch[campo] = entrada[campo];
      }
      const { ok, erros } = validarCor({ ajustes: patch });
      if (!ok) return `Não consegui ajustar: ${erros.join('; ')}`;
      projeto.cor.ajustes = { ...projeto.cor.ajustes, ...patch };
      const mudou = Object.entries(patch).map(([k, v]) => `${k}=${v}`);
      if (!mudou.length) return 'Nada mudou: nenhum ajuste veio no pedido.';
      trabalhos.push({ tipo: 'refazer', nome: projeto.nome });
      return `Ajustei: ${mudou.join(', ')}; refaça o corte para ver.`;
    }

    case 'zerar_cor':
      projeto.cor = corPadrao();
      trabalhos.push({ tipo: 'refazer', nome: projeto.nome });
      return 'Cor zerada: sem LUT, ajustes no padrão. Refaça o corte para ver.';

    case 'baixar_para_projeto':
      return baixarParaProjeto(entrada, projeto);

    default:
      return `Ferramenta desconhecida: ${nome}`;
  }
}

/*
 * Magnific gera o arquivo do lado de fora; esta ferramenta so baixa e guarda
 * na pasta do projeto — o que sai daqui e o mesmo lugar que os campos
 * broll/trilha ja usam (src/fase2/render.js le de la), entao a Fase 2 enxerga
 * sem precisar de nenhum outro fio.
 */
const LIMITE_DOWNLOAD_BYTES = 500 * 1024 * 1024;
const TIMEOUT_DOWNLOAD_MS = 120000;
const TIPOS_DOWNLOAD = ['broll', 'trilha', 'intro', 'sfx', 'voz'];

const EXTENSAO_POR_TIPO_CONTEUDO = {
  'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm',
  'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav',
  'audio/mp4': 'm4a', 'audio/aac': 'm4a', 'audio/ogg': 'ogg',
};

function extensaoDoDownload(resposta, url) {
  const tipoConteudo = (resposta.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (EXTENSAO_POR_TIPO_CONTEUDO[tipoConteudo]) return EXTENSAO_POR_TIPO_CONTEUDO[tipoConteudo];
  const daUrl = path.extname(new URL(url).pathname).replace('.', '').toLowerCase();
  return daUrl || 'bin';
}

async function baixarParaProjeto({ url, tipo, nome }, projeto) {
  if (!url) return 'Preciso da URL do arquivo gerado — nunca invento uma.';
  if (!TIPOS_DOWNLOAD.includes(tipo)) return `Tipo desconhecido: "${tipo}". Use ${TIPOS_DOWNLOAD.join(', ')}.`;

  let resposta;
  try {
    resposta = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_DOWNLOAD_MS) });
  } catch (e) {
    return `Não consegui baixar: ${e.message}`;
  }
  if (!resposta.ok) return `Download falhou: HTTP ${resposta.status}.`;

  const tamanhoDeclarado = Number(resposta.headers.get('content-length') || 0);
  if (tamanhoDeclarado > LIMITE_DOWNLOAD_BYTES) {
    return `Arquivo maior que o limite (${Math.round(LIMITE_DOWNLOAD_BYTES / 1024 / 1024)} MB).`;
  }

  const buffer = Buffer.from(await resposta.arrayBuffer());
  if (buffer.length > LIMITE_DOWNLOAD_BYTES) {
    return `Arquivo maior que o limite (${Math.round(LIMITE_DOWNLOAD_BYTES / 1024 / 1024)} MB).`;
  }

  const ext = extensaoDoDownload(resposta, url);
  const pasta = caminhoProjeto(projeto.nome);
  const base = nome ? String(nome).replace(/[^\w-]+/g, '').slice(0, 48) || 'gerado'
    : crypto.randomBytes(4).toString('hex');

  let destino;
  if (tipo === 'trilha') {
    // So existe uma trilha por projeto — substitui a que ja estava la.
    for (const antiga of ['trilha.mp3', 'trilha.m4a', 'trilha.wav']) {
      fs.rmSync(path.join(pasta, antiga), { force: true });
    }
    const extTrilha = ['mp3', 'm4a', 'wav'].includes(ext) ? ext : 'mp3';
    destino = path.join(pasta, `trilha.${extTrilha}`);
  } else {
    const subpasta = path.join(pasta, tipo);
    fs.mkdirSync(subpasta, { recursive: true });
    destino = path.join(subpasta, `${base}.${ext}`);
  }

  fs.writeFileSync(destino, buffer);

  if (tipo === 'trilha') {
    projeto.estilo = projeto.estilo || {};
    projeto.estilo.elementos = { ...(projeto.estilo.elementos || {}), trilhaSonoraComIA: true };
  }
  if (tipo === 'intro') {
    const ehVideo = /^(mp4|mov|webm|m4v)$/.test(ext);
    // O render da intro fica para outra story: aqui so guarda onde ela esta.
    projeto.intro = { arquivo: path.relative(pasta, destino), tipo: ehVideo ? 'video' : 'imagem', duracao: 2.5 };
  }

  const relativo = path.relative(pasta, destino);
  return `Baixei ${tipo} para ${relativo} (${Math.round(buffer.length / 1024)} KB).`;
}

/**
 * Guarda contra afirmacao falsa.
 *
 * Modelo pequeno as vezes escreve "mudei a cor" sem ter chamado ferramenta
 * nenhuma, ou depois de a ferramenta ter recusado. O chat nao pode afirmar o
 * que nao aconteceu: aqui o texto do modelo e conferido contra o que rodou.
 */
export function conferir(textoBruto, registro) {
  // Modelo pequeno as vezes escreve o proximo turno do usuario. Corta ali.
  const texto = String(textoBruto || '')
    .split(/\n\s*(?:Gabriel|Usuário|Usuario|User|Você|Voce)\s*:/)[0]
    .trim();
  const fezAlgo = registro.length > 0;
  const deuCerto = registro.filter((r) => !/^Não |^Nao |^Ainda /.test(r.resultado));
  const afirma = new RegExp(
    '\\b(mud(ei|ando|ei para)|lig(uei|ando)|deslig(uei|ando)|aprov(ei|ando|ado)'
    + '|refiz|refazendo|renderiz(ei|ando)|aplic(ei|ando)|coloc(quei|ando)'
    + '|troc(quei|ando)|ajust(ei|ando)|atualiz(ei|ado|ando)|pronto)\\b', 'i')
    .test(texto || '');

  if (afirma && !deuCerto.length) {
    const porque = fezAlgo
      ? registro.map((r) => r.resultado).join(' ')
      : 'não executei nenhuma ação';
    return `${texto}\n\n⚠ Na verdade não mudei nada — ${porque} `
      + 'Reformula o pedido, ou usa os botões da aba Estilo.';
  }
  if (deuCerto.length) {
    return `${texto}\n\n${deuCerto.map((r) => `✓ ${r.resultado}`).join('\n')}`;
  }
  return texto;
}

export function situacao(projeto) {
  const f1 = projeto.fase1 || {};
  const e = projeto.estilo || {};
  const c = projeto.cor || corPadrao();
  const clipes = (f1.clipes || []).filter((c2) => c2.ativo !== false);
  const ajustesFora = Object.entries(c.ajustes || {}).filter(([k, v]) => v !== AJUSTES_PADRAO[k]);
  const corMudou = Boolean(c.lut) || ajustesFora.length > 0;
  const linhas = [
    `Projeto: ${projeto.nome} (origem ${projeto.origem?.arquivo}, `
      + `${projeto.origem?.duracao?.toFixed(0)}s de bruto)`,
    `Fase 1: ${f1.status}, ${seg(f1.duracao || 0)}, ${clipes.length} clipes`,
    `Beats: ${clipes.map((c2, i) => `${i + 1}.${c2.bloco}`).join(' ')}`,
    `Clipes: ${clipes.map((c2) => `${c2.id}="${c2.texto.slice(0, 40)}"`).join(' | ')}`,
    `Descartados no corte: ${(f1.descartados || []).length}`,
    `Estilo: edição ${e.tipoEdicao}, cor ${e.corDestaque}, headline ${e.estiloHeadline}, `
      + `legenda ${e.estiloLegenda}`,
    `Elementos ligados: ${Object.entries(e.elementos || {}).filter(([, v]) => v).map(([k]) => k).join(', ') || 'nenhum'}`,
    `Fase 2: ${projeto.fase2?.status || 'nao-iniciada'}`,
  ];
  if (corMudou) {
    const nomeLut = c.lut ? (LUTS.find((l) => l.id === c.lut)?.nome || c.lut) : 'nenhuma';
    const ajustesTexto = ajustesFora.map(([k, v]) => `${k}=${v}`).join(', ') || 'nenhum';
    linhas.push(`Cor: LUT ${nomeLut}, ajustes ${ajustesTexto}`);
  }
  if (projeto.intro?.arquivo) linhas.push(`Intro: ${projeto.intro.arquivo}`);
  return linhas.join('\n');
}
