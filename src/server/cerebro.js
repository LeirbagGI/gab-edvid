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

async function chamarPonte({ sessao, sistema, mensagem, esforco, urlMcp, aoParcial }) {
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
      mcp: { edvid: { type: 'http', url: urlMcp } },
      ferramentas_permitidas: ['mcp__edvid__*'],
      max_voltas: 6,
      timeout_s: 180,
    }),
    signal: AbortSignal.timeout(180000),
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

  vocediz(projeto, texto);

  const sistema = `${SISTEMA}\n\nVocê tem ferramentas MCP; use-as para agir. O projeto atual `
    + 'já está amarrado às ferramentas, não precisa passar o nome dele.';
  const esforco = escolherEsforco(texto);
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
