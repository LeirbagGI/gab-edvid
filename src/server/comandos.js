import { carregar, salvar } from '../fase1/projeto.js';
import { diz, vocediz, tabelaDoCorte, seg } from '../shared/conversa.js';
import { HEADLINES, LEGENDAS, TIPOS_EDICAO, ELEMENTOS } from '../shared/presets.js';

/**
 * O chat do Edvid.
 *
 * IMPORTANTE: isto nao e um modelo de linguagem. E um interpretador de comandos
 * em portugues que mexe no projeto de verdade. Ele reconhece um conjunto fixo
 * de frases; o que nao reconhece, diz que nao entendeu — nunca inventa resposta.
 */

const semAcento = (t) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const CORES = {
  laranja: '#EE7533', vermelho: '#E5352B', rosa: '#F73D9E', roxo: '#8B6BFF',
  azul: '#2E7BEF', verde: '#25C26E', amarelo: '#F5C518', branco: '#FFFFFF',
  ciano: '#38D6D2', preto: '#111111',
};

export const AJUDA = [
  'aprovar / pedir ajuste',
  'refazer o corte',
  'renderizar a fase 2',
  'cor #FF5200  ou  cor laranja',
  'headline contorno · legenda karaokê · edição tela dividida',
  'ligar/desligar zoom, tracking, flash, trilha',
  'tirar o clipe 5 · voltar o clipe 5',
  'o que ficou no corte',
];

/**
 * Interpreta o texto e devolve { projeto, trabalho } — `trabalho` e um pedido
 * para a fila ({tipo, nome}) quando o comando exige render.
 */
export function interpretar(nome, texto) {
  const projeto = carregar(nome);
  if (!projeto) throw new Error('projeto nao encontrado');

  vocediz(projeto, texto);
  const t = semAcento(texto).trim();
  let trabalho = null;

  const responder = (msg) => { diz(projeto, msg); };

  // ---------------------------------------------------------------- ajuda
  if (/^(ajuda|help|o que voce faz|comandos)/.test(t)) {
    responder(`Eu não converso — eu executo. O que eu entendo:\n• ${AJUDA.join('\n• ')}`);

  // ---------------------------------------------------------------- fase 1
  } else if (/\b(aprov)/.test(t)) {
    if (!projeto.fase1?.clipes?.length) responder('Ainda não existe corte para aprovar.');
    else {
      projeto.fase1.status = 'aprovada';
      responder(`Corte aprovado (${seg(projeto.fase1.duracao)}). `
        + 'Agora escolhe o estilo na aba Estilo, ou me diz aqui: "legenda karaokê", "cor #FF5200".');
    }

  } else if (/(pedir ajuste|nao aprov|reprov|ta ruim|esta ruim)/.test(t)) {
    projeto.fase1.status = 'ajustar';
    responder('Marquei para ajuste. Desliga os clipes que não prestam na timeline '
      + '(ou me diz "tirar o clipe 5") e depois manda "refazer o corte".');

  } else if (/(refazer|refaz|refaca).*(corte)?|^refazer/.test(t) && /refa/.test(t)) {
    trabalho = { tipo: 'refazer', nome };
    responder('Refazendo o corte com a timeline como está agora.');

  // ---------------------------------------------------------------- fase 2
  } else if (/(renderiza|render|fase 2|monta o video|finaliza)/.test(t)) {
    if (projeto.fase1?.status !== 'aprovada') {
      responder('A Fase 1 precisa estar aprovada antes. Manda "aprovar" se o corte está bom.');
    } else {
      trabalho = { tipo: 'fase2', nome };
      responder('Coloquei a Fase 2 na fila. Vou aplicar headline, legenda, zoom e trilha.');
    }

  // ---------------------------------------------------------------- estilo
  } else if (/\bcor\b|destaque/.test(t)) {
    const hex = texto.match(/#[0-9a-f]{6}/i)?.[0];
    const nomeCor = Object.keys(CORES).find((c) => t.includes(c));
    const nova = hex || (nomeCor && CORES[nomeCor]);
    if (!nova) responder('Não peguei a cor. Manda "cor #FF5200" ou "cor laranja".');
    else {
      projeto.estilo.corDestaque = nova.toUpperCase();
      responder(`Cor de destaque em ${nova.toUpperCase()}. Os cards da aba Estilo já mudaram.`);
    }

  } else if (/headline/.test(t)) {
    const p = HEADLINES.find((h) => t.includes(semAcento(h.nome)) || t.includes(h.id));
    if (!p) responder(`Headline: ${HEADLINES.map((h) => h.nome).join(', ')}.`);
    else { projeto.estilo.estiloHeadline = p.id; responder(`Headline ${p.nome}.`); }

  } else if (/legenda/.test(t)) {
    const p = LEGENDAS.find((l) => t.includes(semAcento(l.nome)) || t.includes(l.id));
    if (!p) responder(`Legenda: ${LEGENDAS.map((l) => l.nome).join(', ')}.`);
    else { projeto.estilo.estiloLegenda = p.id; responder(`Legenda ${p.nome}.`); }

  } else if (/(tela dividida|edicao limpa|limpa)/.test(t)) {
    const p = TIPOS_EDICAO.find((x) => t.includes(semAcento(x.nome)));
    if (!p) responder(`Tipo de edição: ${TIPOS_EDICAO.map((x) => x.nome).join(', ')}.`);
    else { projeto.estilo.tipoEdicao = p.id; responder(`Tipo de edição: ${p.nome}.`); }

  } else if (/(ligar?|liga|desligar?|desliga|tirar?|tira)\b/.test(t) && /clipe/.test(t)) {
    const n = Number(t.match(/clipe\s*c?(\d+)/)?.[1]);
    const c = projeto.fase1?.clipes?.find((x) => x.id === `c${n}`);
    if (!c) responder(`Não achei o clipe ${n || '?'}. Os clipes vão de c1 a c${projeto.fase1?.clipes?.length || 0}.`);
    else {
      const desligar = /(desliga|desligar|tira|tirar)/.test(t);
      c.ativo = !desligar;
      projeto.fase1.status = 'editado';
      responder(`Clipe c${n} ${desligar ? 'desligado' : 'religado'} — “${c.texto.slice(0, 60)}”. `
        + 'Manda "refazer o corte" para valer no arquivo.');
    }

  } else if (/(ligar?|liga|desligar?|desliga)\b/.test(t)) {
    const el = ELEMENTOS.find((e) => {
      const n = semAcento(e.nome);
      return t.includes(n) || n.split(' ').some((w) => w.length > 4 && t.includes(w));
    });
    if (!el) responder(`Elementos: ${ELEMENTOS.map((e) => e.nome).join(', ')}.`);
    else {
      const ligar = /(^|\s)(ligar?|liga|ativa)/.test(t);
      projeto.estilo.elementos[el.id] = ligar;
      responder(`${el.nome}: ${ligar ? 'ligado' : 'desligado'}.`);
    }

  // ---------------------------------------------------------------- consulta
  } else if (/(o que ficou|resumo|tabela|beats?)/.test(t)) {
    if (!projeto.fase1?.clipes?.length) responder('Ainda não há corte.');
    else tabelaDoCorte(projeto);

  } else {
    responder('Não entendi — e prefiro dizer isso a inventar. '
      + `Eu entendo:\n• ${AJUDA.join('\n• ')}`);
  }

  salvar(projeto);
  return { projeto, trabalho };
}
