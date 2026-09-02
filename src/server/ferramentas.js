import { HEADLINES, LEGENDAS, TIPOS_EDICAO, ELEMENTOS, CORES } from '../shared/presets.js';
import { tabelaDoCorte, seg } from '../shared/conversa.js';

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
];

/** Executa a ferramenta e devolve o que contar de volta para o modelo. */
export function executar(nome, entrada, projeto, trabalhos, registro = []) {
  const r = fazer(nome, entrada, projeto, trabalhos);
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

    default:
      return `Ferramenta desconhecida: ${nome}`;
  }
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
  const clipes = (f1.clipes || []).filter((c) => c.ativo !== false);
  return [
    `Projeto: ${projeto.nome} (origem ${projeto.origem?.arquivo}, `
      + `${projeto.origem?.duracao?.toFixed(0)}s de bruto)`,
    `Fase 1: ${f1.status}, ${seg(f1.duracao || 0)}, ${clipes.length} clipes`,
    `Beats: ${clipes.map((c, i) => `${i + 1}.${c.bloco}`).join(' ')}`,
    `Clipes: ${clipes.map((c) => `${c.id}="${c.texto.slice(0, 40)}"`).join(' | ')}`,
    `Descartados no corte: ${(f1.descartados || []).length}`,
    `Estilo: edição ${e.tipoEdicao}, cor ${e.corDestaque}, headline ${e.estiloHeadline}, `
      + `legenda ${e.estiloLegenda}`,
    `Elementos ligados: ${Object.entries(e.elementos || {}).filter(([, v]) => v).map(([k]) => k).join(', ') || 'nenhum'}`,
    `Fase 2: ${projeto.fase2?.status || 'nao-iniciada'}`,
  ].join('\n');
}
