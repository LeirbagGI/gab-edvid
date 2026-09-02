import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Anthropic from '@anthropic-ai/sdk';
import { RAIZ, LIMITE_CHAT } from '../shared/config.js';
import { carregar, salvar } from '../fase1/projeto.js';
import { diz, vocediz, tabelaDoCorte, seg } from '../shared/conversa.js';
import { HEADLINES, LEGENDAS, TIPOS_EDICAO, ELEMENTOS, CORES } from '../shared/presets.js';

/**
 * O cerebro do chat: conversa de verdade, com o Claude por tras.
 *
 * As acoes que ele pode tomar sao as mesmas do resto do sistema — nao existe
 * caminho paralelo. Sem chave configurada, quem responde e o interpretador de
 * comandos (comandos.js), e o chat avisa que esta no modo limitado.
 */

const MODELO = 'claude-opus-5';

/**
 * Le a chave de um .env fora do Google Drive.
 * Esta pasta (~/gab-edvid) ja esta fora do Drive; o .env nunca vai para la.
 */
export function lerChave() {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  const env = path.join(RAIZ, '.env');
  if (!fs.existsSync(env)) return null;
  for (const linha of fs.readFileSync(env, 'utf8').split('\n')) {
    const m = linha.match(/^\s*ANTHROPIC_API_KEY\s*=\s*(.+?)\s*$/);
    if (m) return m[1].replace(/^["']|["']$/g, '');
  }
  return null;
}

/**
 * Ha alguma credencial da Anthropic disponivel?
 *
 * Aceita as duas formas: a chave num .env/variavel, ou um perfil gravado pelo
 * `ant auth login` — que o SDK resolve sozinho, sem chave escrita em lugar nenhum.
 */
export function temChave() {
  if (lerChave()) return true;
  if (process.env.ANTHROPIC_AUTH_TOKEN) return true;
  const perfil = path.join(os.homedir(), '.config', 'anthropic');
  return fs.existsSync(perfil) && fs.readdirSync(perfil).length > 0;
}

/** Quantas mensagens do modo Claude o projeto ja gastou e quantas restam. */
export function cota(projeto) {
  const usadas = projeto?.chat?.usadas || 0;
  return { usadas, limite: LIMITE_CHAT, restam: Math.max(0, LIMITE_CHAT - usadas) };
}

export const temCota = (projeto) => cota(projeto).restam > 0;

/* ------------------------------------------------------------ ferramentas */

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

/* ------------------------------------------------------------- conversa */

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

export const SISTEMA = `Você é o Edvid, o assistente de um editor de vídeo que roda na máquina do Gabriel.

Como o sistema funciona:
- FASE 1 corta o vídeo bruto sozinho: transcreve com Whisper, corta pelo silêncio real
  do áudio, tira respiro/muleta/falso começo, normaliza o som (+4 dB no HOOK, −14 LUFS)
  e classifica cada clipe em HOOK → DINÂMICA → RECURSOS → CTA.
- O Gabriel revisa a timeline e aprova.
- FASE 2 monta o visual: headline no HOOK, legenda, zoom, tela dividida, trilha.

Regras:
- Responda em português do Brasil, curto e direto. Sem "Claro!" nem preâmbulo.
- Use as ferramentas para fazer o que ele pedir. Não descreva o que faria: faça.
- Cortar silêncio, tirar respiro e dar ritmo JÁ é o que a Fase 1 faz sozinha. Se ele
  pedir isso e o corte já existe, explique que já está feito e diga quantos clipes
  saíram — só refaça o corte se ele tiver mexido na timeline.
- Não invente capacidade que não está nas ferramentas. Se ele pedir algo que o sistema
  não faz (gerar imagem de b-roll, compor música, cortar por assunto), diga isso e
  ofereça o caminho que existe.
- Nunca invente número, nome de arquivo ou estado: use o que está na situação atual.
- Em mudar_estilo, mande SÓ os campos que ele pediu. Não reenvie os outros.
- Para cor, use o NOME (amarelo, verde, azul...) e não invente hex.
- Escreva só a sua resposta. Nunca escreva o próximo turno do Gabriel.
- Não escreva linhas começando com ✓ ou ⚠ — o sistema põe essas sozinho.`;

/**
 * Conversa com o modelo. Devolve { projeto, trabalhos } — `trabalhos` sao pedidos
 * para a fila (refazer/fase2) que o servidor enfileira depois.
 */
export async function conversar(nome, texto) {
  if (!temChave()) throw new Error('sem chave');
  const chave = lerChave();

  const projeto = carregar(nome);
  if (!projeto) throw new Error('projeto nao encontrado');

  if (!temCota(projeto)) throw new Error('sem cota');

  vocediz(projeto, texto);
  const trabalhos = [];
  const registro = [];
  // Sem chave explicita, o SDK resolve pelo perfil do `ant auth login`.
  const cliente = chave ? new Anthropic({ apiKey: chave }) : new Anthropic();

  // Só o histórico de texto entra; tabela e linha de ação são ruído para o modelo.
  const historico = (projeto.conversa || [])
    .filter((m) => m.tipo === 'texto' && m.origem !== 'pipeline')
    .slice(-20)
    // Tira as anotacoes (✓ / ⚠) antes de devolver ao modelo: ele copia o
    // formato e passa a "confirmar" acao que nunca chamou.
    .map((m) => ({
      role: m.quem === 'voce' ? 'user' : 'assistant',
      content: (m.texto || '').split(/\n\n[✓⚠]/)[0].trim(),
    }))
    .filter((m) => m.content);

  const mensagens = [
    ...historico.slice(0, -1),
    { role: 'user', content: `Situação agora:\n${situacao(projeto)}\n\nGabriel: ${texto}` },
  ];

  let resposta = await cliente.messages.create({
    model: MODELO,
    max_tokens: 8000,
    system: SISTEMA,
    tools: FERRAMENTAS,
    output_config: { effort: 'low' },
    messages: mensagens,
  });

  // Laço de ferramentas: executa o que ele pedir e devolve o resultado.
  for (let volta = 0; volta < 6 && resposta.stop_reason === 'tool_use'; volta++) {
    const usos = resposta.content.filter((b) => b.type === 'tool_use');
    mensagens.push({ role: 'assistant', content: resposta.content });
    mensagens.push({
      role: 'user',
      content: usos.map((u) => ({
        type: 'tool_result',
        tool_use_id: u.id,
        content: executar(u.name, u.input || {}, projeto, trabalhos, registro),
      })),
    });
    resposta = await cliente.messages.create({
      model: MODELO,
      max_tokens: 8000,
      system: SISTEMA,
      tools: FERRAMENTAS,
      output_config: { effort: 'low' },
      messages: mensagens,
    });
  }

  const texto_final = resposta.content
    .filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  if (texto_final || registro.length) diz(projeto, conferir(texto_final, registro));

  // So conta depois que a resposta veio: pedido que falhou nao gasta cota.
  projeto.chat = { ...projeto.chat, usadas: (projeto.chat?.usadas || 0) + 1 };
  const { restam } = cota(projeto);
  if (restam <= 3) {
    diz(projeto, restam === 0
      ? `Essa foi a última das ${LIMITE_CHAT} mensagens deste projeto. Daqui em diante `
        + 'eu respondo só os comandos fixos — ou você zera a cota clicando no contador aqui embaixo.'
      : `Restam ${restam} mensagem(ns) de conversa neste projeto.`);
  }

  salvar(projeto);
  return { projeto, trabalhos };
}
