/**
 * A conversa do projeto — o passo a passo que aparece no chat lateral.
 *
 * Cada etapa do pipeline escreve aqui o que fez, e o histórico fica salvo no
 * projeto.json. Quem abre o projeto uma semana depois lê a mesma narração.
 */

/**
 * Mensagem de texto do Edvid.
 *
 * `origem` separa duas coisas que parecem iguais na tela mas nao sao para o
 * modelo: 'pipeline' e a narracao automatica das fases; 'chat' e resposta a
 * uma pergunta. So o 'chat' volta como historico — alimentar a narracao ensina
 * o modelo a narrar em vez de executar.
 */
export function diz(projeto, texto, origem = 'chat') {
  return empurrar(projeto, { quem: 'edvid', tipo: 'texto', texto, origem });
}

/** Narracao automatica do pipeline. */
export const narra = (projeto, texto) => diz(projeto, texto, 'pipeline');

/** Mensagem do Gabriel (o que ele digitou no chat). */
export function vocediz(projeto, texto) {
  return empurrar(projeto, { quem: 'voce', tipo: 'texto', texto });
}

/**
 * Linha de acao, como as do Claude Code: "Criado projeto.json, 2 ferramentas +47 -0".
 * `detalhe` e o texto que abre ao clicar na seta.
 */
export function acao(projeto, { arquivo, ferramentas = 1, mais = 0, menos = 0, detalhe = '' }) {
  return empurrar(projeto, { quem: 'edvid', tipo: 'acao', arquivo, ferramentas, mais, menos, detalhe });
}

/** A tabela "O que ficou no corte": numero, beat e fala de cada clipe. */
export function tabelaDoCorte(projeto) {
  const linhas = (projeto.fase1?.clipes || [])
    .filter((c) => c.ativo !== false)
    .map((c, i) => ({ n: i + 1, beat: c.bloco, fala: c.texto }));
  return empurrar(projeto, {
    quem: 'edvid', tipo: 'tabela', titulo: 'O que ficou no corte:', linhas,
  });
}

function empurrar(projeto, msg) {
  projeto.conversa = projeto.conversa || [];
  projeto.conversa.push({ ...msg, em: new Date().toISOString() });
  // O histórico não pode crescer sem limite dentro do projeto.json.
  if (projeto.conversa.length > 300) projeto.conversa.splice(0, projeto.conversa.length - 300);
  return projeto;
}

/** Segundos em "16,1s" — o formato que a referencia usa. */
export const seg = (s) => `${Number(s).toFixed(1).replace('.', ',')}s`;
