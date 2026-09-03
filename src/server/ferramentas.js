import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { HEADLINES, LEGENDAS, TIPOS_EDICAO, ELEMENTOS, CORES } from '../shared/presets.js';
import { tabelaDoCorte, seg } from '../shared/conversa.js';
import { LUTS, AJUSTES_PADRAO, corPadrao, validarCor } from '../shared/cor.js';
import { caminhoProjeto } from '../fase1/projeto.js';
import { TRANSICOES, EFEITOS, ANIMACOES_INTRO, acharEfeito } from '../shared/efeitos.js';
import { gerarSrt, gerarAss } from '../shared/legenda-export.js';
import { editarPalavra, validarConfigLegenda } from './legenda-edicao.js';

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
  {
    name: 'mudar_transicao',
    description: `Muda a transição entre clipes: sem "clipe" é global (todos); com "clipe" (id, ex: c3), `
      + `só naquele. Ids: ${lista(TRANSICOES)}.`,
    input_schema: {
      type: 'object',
      properties: {
        tipo: { type: 'string', enum: TRANSICOES.map((t) => t.id) },
        clipe: { type: 'string', description: 'Id do clipe, ex: c3. Sem isso, muda a transição global.' },
      },
      required: ['tipo'],
    },
  },
  {
    name: 'ligar_efeito',
    description: `Liga ou desliga um efeito visual. Ids: ${lista(EFEITOS)}. `
      + 'Global por padrão; passe "clipe" (id, ex: c3) para efeito por clipe (obrigatório para "congelar"). '
      + '"intensidade" é 0 a 1 (ou segundos, 0 a 5, para congelar). "posicao" (topo|base) só serve para barra-progresso.',
    input_schema: {
      type: 'object',
      properties: {
        efeito: { type: 'string', enum: EFEITOS.map((e) => e.id) },
        ligado: { type: 'boolean' },
        intensidade: { type: 'number' },
        clipe: { type: 'string' },
        posicao: { type: 'string', enum: ['topo', 'base'] },
      },
      required: ['efeito', 'ligado'],
    },
  },
  {
    name: 'definir_intro',
    description: 'Ajusta duração (só imagem), animação ou headline da intro que já existe no projeto. '
      + 'Não cria a intro do zero — o arquivo entra por baixar_para_projeto (tipo intro) ou pelo upload da aba FASE 2.',
    input_schema: {
      type: 'object',
      properties: {
        duracao: { type: 'number', description: 'Segundos, só para intro de imagem.' },
        animacao: { type: 'string', enum: ANIMACOES_INTRO },
        headline: { type: 'boolean', description: 'Mostrar a headline já durante a intro.' },
      },
      required: [],
    },
  },
  {
    name: 'tirar_intro',
    description: 'Remove a intro do projeto (apaga o arquivo e o campo).',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'configurar_legenda',
    description: 'Ajusta posição, escala, alinhamento, caixa alta, antecedência ou máximo de palavras por bloco '
      + 'da legenda — sobrepõe o preset escolhido em mudar_estilo, sem trocar o estilo.',
    input_schema: {
      type: 'object',
      properties: {
        posicao: { type: 'string', enum: ['baixo', 'meio', 'alto'] },
        escala: { type: 'number', description: '0.7 a 1.6' },
        alinhamento: { type: 'string', enum: ['centro', 'esquerda'] },
        maiusculas: { type: 'boolean' },
        antecedencia: { type: 'number', description: 'Segundos, 0 a 0.4 — quanto antes do áudio a palavra acende.' },
        maxPalavras: { type: 'number', description: 'Palavras por bloco, 1 a 6.' },
      },
      required: [],
    },
  },
  {
    name: 'destacar_palavras',
    description: 'Marca destaque nas palavras da lista (sem acento, sem caixa) em todos os clipes. '
      + 'Com substituir: true, desmarca o destaque das que não estão na lista.',
    input_schema: {
      type: 'object',
      properties: {
        palavras: { type: 'array', items: { type: 'string' }, description: 'Ex: ["faturamento", "processo"]' },
        substituir: { type: 'boolean' },
      },
      required: ['palavras'],
    },
  },
  {
    name: 'editar_palavra',
    description: 'Edita o texto ou oculta uma palavra da legenda (oculta: a legenda pula, o áudio continua). '
      + 'Para dividir, juntar ou deslocar no tempo, use a aba de edição de legenda.',
    input_schema: {
      type: 'object',
      properties: {
        clipe: { type: 'string', description: 'Id do clipe, ex: c3' },
        indice: { type: 'number', description: 'Índice da palavra dentro do clipe, começando em 0' },
        texto: { type: 'string' },
        oculta: { type: 'boolean' },
      },
      required: ['clipe', 'indice'],
    },
  },
  {
    name: 'exportar_legenda',
    description: 'Exporta a legenda do corte em arquivo .srt ou .ass, na pasta do projeto.',
    input_schema: {
      type: 'object',
      properties: { formato: { type: 'string', enum: ['srt', 'ass'] } },
      required: ['formato'],
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

    case 'mudar_transicao': {
      if (!TRANSICOES.some((t) => t.id === entrada.tipo)) return `Não conheço a transição "${entrada.tipo}".`;
      if (entrada.clipe) {
        const c = projeto.fase1?.clipes?.find((x) => x.id === entrada.clipe);
        if (!c) return `Não existe o clipe ${entrada.clipe}.`;
        c.transicao = { tipo: entrada.tipo };
        return `Transição do clipe ${entrada.clipe}: ${entrada.tipo}.`;
      }
      projeto.estilo.transicao = { tipo: entrada.tipo };
      projeto.estilo.elementos = { ...(projeto.estilo.elementos || {}), flashNaTransicao: entrada.tipo === 'flash' };
      return `Transição global: ${entrada.tipo}.`;
    }

    case 'ligar_efeito': {
      const def = acharEfeito(entrada.efeito);
      if (!def) return `Não conheço o efeito "${entrada.efeito}".`;

      if (def.escopo === 'clipe') {
        if (!entrada.clipe) return `O efeito ${entrada.efeito} é por clipe — diga qual (ex: c3).`;
        const c = projeto.fase1?.clipes?.find((x) => x.id === entrada.clipe);
        if (!c) return `Não existe o clipe ${entrada.clipe}.`;
        c.efeitos = { ...(c.efeitos || {}) };
        if (entrada.ligado) {
          c.efeitos[entrada.efeito] = typeof entrada.intensidade === 'number'
            ? Math.min(5, Math.max(0, entrada.intensidade)) : 1.5;
        } else {
          delete c.efeitos[entrada.efeito];
          if (!Object.keys(c.efeitos).length) delete c.efeitos;
        }
        return `${entrada.efeito} no clipe ${entrada.clipe}: ${entrada.ligado ? 'ligado' : 'desligado'}.`;
      }

      projeto.estilo.efeitos = { ...(projeto.estilo.efeitos || {}) };
      if (entrada.efeito === 'barra-progresso') {
        if (entrada.ligado) {
          projeto.estilo.efeitos.barraProgresso = { posicao: entrada.posicao === 'base' ? 'base' : 'topo' };
        } else {
          delete projeto.estilo.efeitos.barraProgresso;
        }
      } else if (entrada.efeito === 'blur-fundo') {
        if (entrada.ligado) projeto.estilo.efeitos.blurFundo = true; else delete projeto.estilo.efeitos.blurFundo;
      } else if (entrada.efeito === 'letterbox') {
        if (entrada.ligado) projeto.estilo.efeitos.letterbox = true; else delete projeto.estilo.efeitos.letterbox;
      } else if (entrada.ligado) {
        projeto.estilo.efeitos[entrada.efeito] = typeof entrada.intensidade === 'number'
          ? Math.min(1, Math.max(0, entrada.intensidade)) : 0.5;
      } else {
        delete projeto.estilo.efeitos[entrada.efeito];
      }
      return `${entrada.efeito}: ${entrada.ligado ? 'ligado' : 'desligado'}.`;
    }

    case 'definir_intro': {
      if (!projeto.intro) return 'Ainda não há intro — gere ou envie uma imagem/vídeo primeiro.';
      const mudou = [];
      if (typeof entrada.duracao === 'number') {
        if (projeto.intro.tipo !== 'imagem') {
          return 'Duração só se ajusta em intro de imagem — vídeo usa a duração de origem.';
        }
        projeto.intro.duracao = entrada.duracao;
        mudou.push(`duracao=${entrada.duracao}`);
      }
      if (entrada.animacao) {
        if (!ANIMACOES_INTRO.includes(entrada.animacao)) return `Não conheço a animação "${entrada.animacao}".`;
        projeto.intro.animacao = entrada.animacao;
        mudou.push(`animacao=${entrada.animacao}`);
      }
      if (typeof entrada.headline === 'boolean') {
        projeto.intro.headline = entrada.headline;
        mudou.push(`headline=${entrada.headline}`);
      }
      return mudou.length ? `Intro: ${mudou.join(', ')}.` : 'Nada mudou: nenhum campo veio no pedido.';
    }

    case 'tirar_intro': {
      if (!projeto.intro) return 'Já não há intro.';
      if (projeto.intro.arquivo) {
        try {
          fs.rmSync(path.join(caminhoProjeto(projeto.nome), projeto.intro.arquivo), { force: true });
        } catch { /* arquivo ja sumiu — nao trava a remocao do campo */ }
      }
      delete projeto.intro;
      return 'Intro removida.';
    }

    case 'configurar_legenda': {
      const erros = validarConfigLegenda(entrada);
      if (erros.length) return `Não consegui configurar: ${erros.join('; ')}`;
      const patch = {};
      for (const campo of ['posicao', 'escala', 'alinhamento', 'maiusculas', 'antecedencia', 'maxPalavras']) {
        if (entrada[campo] !== undefined) patch[campo] = entrada[campo];
      }
      if (!Object.keys(patch).length) return 'Nada mudou: nenhum campo veio no pedido.';
      projeto.estilo.legenda = { ...(projeto.estilo.legenda || {}), ...patch };
      return `Legenda: ${Object.entries(patch).map(([k, v]) => `${k}=${v}`).join(', ')}.`;
    }

    case 'destacar_palavras': {
      const alvo = (entrada.palavras || []).map((s) => String(s));
      if (!alvo.length) return 'Preciso de ao menos uma palavra.';
      const normalizar = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      const setAlvo = new Set(alvo.map(normalizar));
      let marcadas = 0;
      for (const c of projeto.fase1?.clipes || []) {
        for (const p of c.palavras || []) {
          const limpo = normalizar(p.texto.replace(/[.,!?;:]+$/, ''));
          if (setAlvo.has(limpo)) { p.destaque = true; marcadas++; } else if (entrada.substituir) p.destaque = false;
        }
      }
      return marcadas
        ? `Destaquei ${marcadas} palavra(s): ${alvo.join(', ')}.`
        : `Não achei nenhuma dessas palavras no corte: ${alvo.join(', ')}.`;
    }

    case 'editar_palavra': {
      try {
        const p = editarPalavra(projeto.fase1?.clipes || [], entrada);
        return `Palavra ${entrada.indice} do clipe ${entrada.clipe}: "${p.texto}"${p.oculta ? ' (oculta)' : ''}.`;
      } catch (e) {
        return `Não consegui editar: ${e.message}`;
      }
    }

    case 'exportar_legenda': {
      const formato = entrada.formato === 'ass' ? 'ass' : 'srt';
      const conteudo = formato === 'srt'
        ? gerarSrt(projeto.fase1?.clipes || [], projeto.estilo || {})
        : gerarAss(projeto.fase1?.clipes || [], projeto.estilo || {}, projeto.saida);
      fs.writeFileSync(path.join(caminhoProjeto(projeto.nome), `legenda.${formato}`), conteudo);
      return `Exportei a legenda em legenda.${formato}.`;
    }

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
  if (e.transicao?.tipo && e.transicao.tipo !== 'corte') {
    linhas.push(`Transição: ${e.transicao.tipo}`);
  }
  const efeitosLigados = Object.entries(e.efeitos || {}).filter(([, v]) => v);
  if (efeitosLigados.length) {
    linhas.push(`Efeitos: ${efeitosLigados.map(([k, v]) => (v === true ? k : `${k}=${JSON.stringify(v)}`)).join(', ')}`);
  }
  if (projeto.intro?.arquivo) {
    linhas.push(`Intro: ${projeto.intro.arquivo} (${projeto.intro.tipo}, ${projeto.intro.duracao}s`
      + `${projeto.intro.animacao ? `, ${projeto.intro.animacao}` : ''})`);
  }
  if (e.legenda && Object.keys(e.legenda).length) {
    linhas.push(`Legenda (override sobre o preset): ${Object.entries(e.legenda).map(([k, v]) => `${k}=${v}`).join(', ')}`);
  }
  return linhas.join('\n');
}
