import { OLLAMA } from '../shared/config.js';
import { carregar, salvar } from '../fase1/projeto.js';
import { diz, vocediz } from '../shared/conversa.js';
import { FERRAMENTAS, executar, situacao, SISTEMA, conferir } from './cerebro.js';

/**
 * Conversa usando um modelo que roda na propria maquina, via Ollama.
 *
 * De graca e offline. Usa exatamente as mesmas ferramentas do modo Anthropic —
 * a diferenca e so quem decide qual chamar. Nao consome cota, porque nao custa.
 */

/** O Ollama esta de pe e com o modelo baixado? */
export async function ollamaPronto() {
  try {
    const r = await fetch(`${OLLAMA.url}/api/tags`, { signal: AbortSignal.timeout(1200) });
    if (!r.ok) return false;
    const { models = [] } = await r.json();
    const base = (n) => n.split(':')[0];
    return models.some((m) => m.name === OLLAMA.modelo || base(m.name) === base(OLLAMA.modelo));
  } catch {
    return false;
  }
}

/** As ferramentas no formato que o Ollama espera (compatível com OpenAI). */
const ferramentasOllama = () => FERRAMENTAS.map((f) => ({
  type: 'function',
  function: { name: f.name, description: f.description, parameters: f.input_schema },
}));

async function chamar(mensagens) {
  const r = await fetch(`${OLLAMA.url}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA.modelo,
      messages: mensagens,
      tools: ferramentasOllama(),
      stream: false,
      options: { temperature: 0.2 },
    }),
    signal: AbortSignal.timeout(120000),
  });
  if (!r.ok) throw new Error(`ollama respondeu ${r.status}`);
  return (await r.json()).message;
}

export async function conversarLocal(nome, texto) {
  const projeto = carregar(nome);
  if (!projeto) throw new Error('projeto nao encontrado');

  vocediz(projeto, texto);
  const trabalhos = [];
  const registro = [];

  const historico = (projeto.conversa || [])
    .filter((m) => m.tipo === 'texto' && m.origem !== 'pipeline')
    .slice(-12)
    // Tira as anotacoes (✓ / ⚠) antes de devolver ao modelo: ele copia o
    // formato e passa a "confirmar" acao que nunca chamou.
    .map((m) => ({
      role: m.quem === 'voce' ? 'user' : 'assistant',
      content: (m.texto || '').split(/\n\n[✓⚠]/)[0].trim(),
    }))
    .filter((m) => m.content);

  const mensagens = [
    { role: 'system', content: SISTEMA },
    ...historico.slice(0, -1),
    { role: 'user', content: `Situação agora:\n${situacao(projeto)}\n\nGabriel: ${texto}` },
  ];

  let msg = await chamar(mensagens);

  // Laço de ferramentas. Modelo pequeno às vezes insiste; 4 voltas bastam.
  for (let volta = 0; volta < 4 && msg.tool_calls?.length; volta++) {
    mensagens.push(msg);
    for (const chamada of msg.tool_calls) {
      const entrada = typeof chamada.function.arguments === 'string'
        ? JSON.parse(chamada.function.arguments || '{}')
        : (chamada.function.arguments || {});
      mensagens.push({
        role: 'tool',
        content: executar(chamada.function.name, entrada, projeto, trabalhos, registro),
      });
    }
    msg = await chamar(mensagens);
  }

  const resposta = conferir((msg.content || '').trim(), registro);
  diz(projeto, resposta || 'Não entendi o pedido.');
  salvar(projeto);
  return { projeto, trabalhos };
}
