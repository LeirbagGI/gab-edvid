import { PONTE_URL, LIMITE_CHAT, PORTA_PREVIEW } from '../shared/config.js';
import { carregar, salvar } from '../fase1/projeto.js';
import { diz, vocediz } from '../shared/conversa.js';
import { conferir, situacao } from './ferramentas.js';
import { iniciarRegistro, lerRegistro } from './mcp.js';

/**
 * O cerebro do chat: conversa de verdade, com o Claude por tras — via a
 * ponte-claude (CLI da assinatura do Fable 5.1, sem chave de API em lugar
 * nenhum). As acoes que ele pode tomar sao as mesmas do resto do sistema:
 * as ferramentas viram MCP em mcp.js, o Claude chama pelo `--mcp-config`.
 *
 * Sem a ponte no ar, quem responde e o interpretador de comandos
 * (comandos.js), e o chat avisa que esta no modo limitado.
 */

export const MODELO = 'claude-fable-5-1';

let cachePonte = { ok: false, em: 0 };

/**
 * A ponte-claude esta de pe? Resultado em cache por 30s — bater em
 * `/saude` a cada mensagem seria desperdicio, e a ponte nao cai e sobe
 * o tempo todo.
 */
export async function temPonte() {
  const agora = Date.now();
  if (agora - cachePonte.em < 30000) return cachePonte.ok;
  let ok = false;
  try {
    const r = await fetch(`${PONTE_URL}/saude`, { signal: AbortSignal.timeout(2000) });
    ok = r.ok && (await r.json())?.ok === true;
  } catch {
    ok = false;
  }
  cachePonte = { ok, em: agora };
  return ok;
}

/** Quantas mensagens do modo Claude o projeto ja gastou e quantas restam. */
export function cota(projeto) {
  const usadas = projeto?.chat?.usadas || 0;
  return { usadas, limite: LIMITE_CHAT, restam: Math.max(0, LIMITE_CHAT - usadas) };
}

export const temCota = (projeto) => cota(projeto).restam > 0;

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

/** Texto curto ("aprovar", "cor azul") nao precisa de esforco alto. */
const RE_COMANDO_CURTO = /\b(aprov|refaz|render|cor|legenda|headline|liga|deslig|tira|clipe)\w*/i;

function escolherEsforco(texto) {
  return texto.length < 60 && RE_COMANDO_CURTO.test(texto) ? 'low' : 'medium';
}

/*
 * Magnific (geracao por IA: imagem, video, audio, upscale, b-roll de banco)
 * so entra no MCP da chamada quando o pedido de verdade precisa dele — o
 * catalogo dele custa 39 mil tokens por sessao, caro demais para carregar em
 * toda mensagem. So funciona pela ponte-claude (na VPS, autenticado la); no
 * Mac essa parte fica so implementada e testada com a ponte de mentira.
 */
export const RE_MAGNIFIC = /gerar|gera\s|cria(r)?\s+(uma\s+|um\s+)?(imagem|foto|intro|vinheta|trilha|m[uú]sica|efeito|sfx|narra|voz|locu[cç][aã]o)|intro com ia|com ia|magnific|upscale|melhorar a qualidade|stock|b-?roll|imagem de fundo|dublar|dublagem/i;

export const precisaMagnific = (texto) => RE_MAGNIFIC.test(String(texto || ''));

/** As unicas ferramentas do Magnific liberadas — nada de "*", uma por uma. */
const FERRAMENTAS_MAGNIFIC = [
  'mcp__magnific__account_balance',
  'mcp__magnific__images_models_list',
  'mcp__magnific__images_generate',
  'mcp__magnific__images_upscale',
  'mcp__magnific__images_remove_background',
  'mcp__magnific__images_expand',
  'mcp__magnific__audio_music_generate',
  'mcp__magnific__audio_sfx_generate',
  'mcp__magnific__audio_tts',
  'mcp__magnific__audio_voices_list',
  'mcp__magnific__video_models_list',
  'mcp__magnific__video_generate',
  'mcp__magnific__video_upscale',
  'mcp__magnific__stock_search',
  'mcp__magnific__stock_download',
  'mcp__magnific__creation_status',
  'mcp__magnific__creations_wait',
  'mcp__magnific__creations_get',
];

const BLOCO_MAGNIFIC = `

Geração por IA (Magnific):
Isso custa créditos de verdade — só use quando o Gabriel pedir geração por IA (imagem, b-roll,
intro, trilha, sfx, voz, upscale). Siga esta ordem:
1. Se for a primeira geração por IA desta sessão, chame account_balance antes de gerar.
2. Gere no formato certo: imagem 9:16 para b-roll e intro, música com a duração igual à do
   corte, voz em pt-BR.
3. Chame creations_wait até a geração terminar.
4. Pegue a URL do resultado em creations_get.
5. Chame a ferramenta do Edvid baixar_para_projeto com essa URL e o tipo certo.
6. Diga o que gerou e quanto custou em créditos.
Nunca invente URL — use só a que creations_get devolveu. Se a geração falhar, diga o erro, não
finja que deu certo.`;

/** Ultimas 20 mensagens de texto do chat, formatadas para o histórico. */
function historicoTexto(projeto) {
  return (projeto.conversa || [])
    .filter((m) => m.tipo === 'texto' && m.origem !== 'pipeline')
    .slice(-20)
    // Tira as anotacoes (✓ / ⚠) antes de devolver ao modelo: ele copia o
    // formato e passa a "confirmar" acao que nunca chamou.
    .map((m) => `${m.quem === 'voce' ? 'Gabriel' : 'Edvid'}: ${(m.texto || '').split(/\n\n[✓⚠]/)[0].trim()}`)
    .filter((l) => l.split(': ').slice(1).join(': '))
    .join('\n');
}

/** Le o stream `text/event-stream` da ponte, chamando `aoParcial` a cada texto novo. */
async function lerStream(response, aoParcial) {
  const leitor = response.body.getReader();
  const decodificador = new TextDecoder();
  let sobra = '';
  let acumulado = '';
  let resultado = null;
  let erro = null;

  const processarBloco = (bloco) => {
    let evento = 'message';
    const linhasDado = [];
    for (const linha of bloco.split('\n')) {
      if (linha.startsWith('event:')) evento = linha.slice(6).trim();
      else if (linha.startsWith('data:')) linhasDado.push(linha.slice(5).trim());
    }
    if (!linhasDado.length) return;
    let dado;
    try {
      dado = JSON.parse(linhasDado.join('\n'));
    } catch {
      return;
    }
    if (evento === 'erro') { erro = dado; return; }
    if (evento === 'fim' && dado?.rc) { erro = erro || dado; return; }

    if (dado?.type === 'stream_event') {
      const ev = dado.event || {};
      if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
        acumulado += ev.delta.text || '';
        aoParcial?.(acumulado);
      }
    } else if (dado?.type === 'result') {
      resultado = dado;
    }
  };

  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    sobra += decodificador.decode(value, { stream: true });
    const blocos = sobra.split('\n\n');
    sobra = blocos.pop();
    for (const bloco of blocos) if (bloco.trim()) processarBloco(bloco);
  }
  if (sobra.trim()) processarBloco(sobra);

  return { resultado, erro, acumulado };
}

async function chamarPonte({
  sessao, sistema, mensagem, esforco, urlMcp, aoParcial, usaMagnific,
}) {
  const mcp = usaMagnific
    ? { edvid: { type: 'http', url: urlMcp }, magnific: { type: 'http', url: 'https://mcp.magnific.com' } }
    : { edvid: { type: 'http', url: urlMcp } };
  const ferramentasPermitidas = usaMagnific
    ? ['mcp__edvid__*', ...FERRAMENTAS_MAGNIFIC]
    : ['mcp__edvid__*'];
  // O catalogo do Magnific e grande e a geracao demora — mais voltas e mais
  // tempo so quando ele esta na jogada.
  const timeoutS = usaMagnific ? 600 : 180;
  const maxVoltas = usaMagnific ? 12 : 6;

  const resposta = await fetch(`${PONTE_URL}/conversar`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      cliente: 'edvid',
      sessao: sessao || null,
      modelo: MODELO,
      esforco,
      sistema,
      mensagem,
      mcp,
      ferramentas_permitidas: ferramentasPermitidas,
      max_voltas: maxVoltas,
      timeout_s: timeoutS,
    }),
    signal: AbortSignal.timeout(timeoutS * 1000),
  });
  if (!resposta.ok) throw new Error(`ponte respondeu ${resposta.status}`);
  return lerStream(resposta, aoParcial);
}

/**
 * Conversa com o modelo pela ponte. Devolve o projeto ja salvo — os
 * `trabalhos` (refazer/fase2) sao enfileirados pela propria ferramenta MCP
 * (mcp.js), nao aqui.
 */
export async function conversar(nome, texto, { aoParcial, urlMcp } = {}) {
  const projeto = carregar(nome);
  if (!projeto) throw new Error('projeto nao encontrado');
  if (!temCota(projeto)) throw new Error('sem cota');

  // O historico e o que ja estava na conversa antes desta mensagem — o
  // `vocediz` logo abaixo empurra a mensagem atual, que ja vai explicita no
  // fim de `mensagem`; incluir os dois duplicaria a fala do Gabriel. So
  // entra quando nao ha sessao (o CLI guarda o historico sozinho); fica
  // pronto tambem para a tentativa sem --resume, se a sessao for recusada.
  const temSessao = Boolean(projeto.chat?.sessao);
  const historico = historicoTexto(projeto);
  const usaMagnific = precisaMagnific(texto);

  vocediz(projeto, texto);
  // Grava ja: as ferramentas MCP rodam em outro fluxo e recarregam o projeto
  // do disco; se a fala do Gabriel ficasse so em memoria, o `salvar` delas
  // apagaria a mensagem, e o nosso `salvar` no fim apagaria o que elas fizeram.
  salvar(projeto);

  const sistema = `${SISTEMA}\n\nVocê tem ferramentas MCP; use-as para agir. O projeto atual `
    + 'já está amarrado às ferramentas, não precisa passar o nome dele.'
    + (usaMagnific ? BLOCO_MAGNIFIC : '');
  const esforco = usaMagnific ? 'medium' : escolherEsforco(texto);
  const urlEfetiva = urlMcp || `http://127.0.0.1:${PORTA_PREVIEW}/mcp/${encodeURIComponent(nome)}`;

  const montarMensagem = () => (temSessao
    ? `Situação agora:\n${situacao(projeto)}\n\nGabriel: ${texto}`
    : `${historico}\n\nSituação agora:\n${situacao(projeto)}\n\nGabriel: ${texto}`.trim());

  iniciarRegistro(nome);

  let saida;
  try {
    saida = await chamarPonte({
      sessao: projeto.chat?.sessao,
      sistema,
      mensagem: montarMensagem(),
      esforco,
      urlMcp: urlEfetiva,
      aoParcial,
      usaMagnific,
    });
  } catch (e) {
    throw new Error(`ponte: ${e.message}`);
  }

  // Sessao recusada pelo CLI (ex: --resume de sessao que nao existe mais):
  // zera e tenta uma unica vez de novo, sem --resume — com o historico
  // completo, ja que o CLI nao tem mais o contexto guardado.
  if (saida.erro && temSessao && /sess[aã]o/i.test(String(saida.erro?.stderr || saida.erro?.erro || ''))) {
    projeto.chat = { ...projeto.chat, sessao: null };
    iniciarRegistro(nome);
    saida = await chamarPonte({
      sessao: null,
      sistema,
      mensagem: `${historico}\n\nSituação agora:\n${situacao(projeto)}\n\nGabriel: ${texto}`.trim(),
      esforco,
      urlMcp: urlEfetiva,
      aoParcial,
      usaMagnific,
    });
  }

  if (saida.erro) {
    throw new Error(saida.erro?.stderr || saida.erro?.erro || 'a ponte devolveu erro');
  }

  const dadosResultado = saida.resultado || {};
  if (dadosResultado.is_error) {
    throw new Error(dadosResultado.result || 'o modelo devolveu erro');
  }

  const textoFinal = (typeof dadosResultado.result === 'string' && dadosResultado.result)
    || saida.acumulado || '';

  // Recarrega do disco: o que as ferramentas gravaram (aprovacao, cor, clipe,
  // tabela na conversa) tem que sobreviver ao `salvar` daqui de baixo.
  const fresco = carregar(nome);
  if (fresco) Object.assign(projeto, fresco);

  if (dadosResultado.session_id) projeto.chat = { ...projeto.chat, sessao: dadosResultado.session_id };
  projeto.chat = { ...projeto.chat, usadas: (projeto.chat?.usadas || 0) + 1 };
  const uso = dadosResultado.usage || {};
  projeto.chat.ultimoUso = {
    entrada: uso.input_tokens ?? uso.entrada ?? 0,
    cache: uso.cache_read_input_tokens ?? uso.cache ?? 0,
    saida: uso.output_tokens ?? uso.saida ?? 0,
    custo: dadosResultado.total_cost_usd ?? 0,
  };

  diz(projeto, conferir(textoFinal, lerRegistro(nome)));

  const { restam } = cota(projeto);
  if (restam <= 3) {
    diz(projeto, restam === 0
      ? `Essa foi a última das ${LIMITE_CHAT} mensagens deste projeto. Daqui em diante `
        + 'eu respondo só os comandos fixos — ou você zera a cota clicando no contador aqui embaixo.'
      : `Restam ${restam} mensagem(ns) de conversa neste projeto.`);
  }

  salvar(projeto);
  return { projeto, trabalhos: [] };
}
