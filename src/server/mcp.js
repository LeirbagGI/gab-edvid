import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { FERRAMENTAS, executar } from './ferramentas.js';

/**
 * Servidor MCP do Edvid: as mesmas ferramentas do chat, expostas para o
 * Claude da ponte (B1) chamar via `--mcp-config`.
 *
 * Uma rota `/mcp/:nome` por projeto — o nome ja amarra a ferramenta ao
 * projeto certo, o Claude nao precisa passar o nome em cada chamada. Sem
 * sessao (`sessionIdGenerator: undefined`): um McpServer novo a cada
 * requisicao e barato e evita estado preso entre conversas.
 */

/** Registro de ferramentas executadas por projeto — alimenta conferir(). */
const registros = new Map();

export function iniciarRegistro(nome) {
  registros.set(nome, []);
  return registros.get(nome);
}

export function lerRegistro(nome) {
  return registros.get(nome) || [];
}

/** 127.0.0.1/::1 ou a faixa docker 172.16.0.0/12. */
function origemPermitida(ip) {
  if (!ip) return false;
  const limpo = ip.replace(/^::ffff:/, '');
  if (limpo === '127.0.0.1' || limpo === '::1' || limpo === 'localhost') return true;
  const m = limpo.match(/^172\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (!m) return false;
  const segundo = Number(m[1]);
  return segundo >= 16 && segundo <= 31;
}

/** Converte um input_schema JSON (so string/boolean/number/enum) para forma zod. */
function paraZod(inputSchema) {
  const props = inputSchema?.properties || {};
  const obrigatorios = new Set(inputSchema?.required || []);
  const forma = {};
  for (const [campo, def] of Object.entries(props)) {
    let z_campo;
    if (def.enum) z_campo = z.enum(def.enum);
    else if (def.type === 'boolean') z_campo = z.boolean();
    else if (def.type === 'number') z_campo = z.number();
    else z_campo = z.string();
    if (def.description) z_campo = z_campo.describe(def.description);
    if (!obrigatorios.has(campo)) z_campo = z_campo.optional();
    forma[campo] = z_campo;
  }
  return forma;
}

/**
 * Monta a rota /mcp/:nome no `app`. Precisa entrar ANTES de
 * `app.use(express.json())` — o transporte streamable le o corpo cru da
 * requisicao sozinho, e um `express.json()` anterior ja teria drenado o
 * stream, deixando o corpo vazio para o SDK.
 */
export function montarMcp(app, { carregar, salvar, transmitir, fila }) {
  app.all('/mcp/:nome', async (req, res) => {
    if (!origemPermitida(req.socket.remoteAddress)) {
      res.status(403).json({ erro: 'acesso negado' });
      return;
    }

    const { nome } = req.params;
    const projeto = carregar(nome);
    if (!projeto) {
      res.status(404).json({ erro: 'projeto nao encontrado' });
      return;
    }

    const servidor = new McpServer({ name: 'edvid', version: '1.0.0' });
    for (const f of FERRAMENTAS) {
      servidor.registerTool(f.name, {
        description: f.description,
        inputSchema: paraZod(f.input_schema),
      }, async (entrada) => {
        const trabalhos = [];
        const registro = registros.get(nome) || iniciarRegistro(nome);
        // `executar` e sincrona para quase tudo; so `baixar_para_projeto`
        // devolve uma Promise (baixa arquivo de verdade) — `await` aqui
        // funciona igual para os dois casos.
        const resultado = await executar(f.name, entrada || {}, projeto, trabalhos, registro);
        salvar(projeto);
        trabalhos.forEach((t) => fila.enfileirar(t.tipo, { nome: t.nome }));
        transmitir({ tipo: 'projeto', projeto });
        return { content: [{ type: 'text', text: resultado }] };
      });
    }

    const transporte = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      transporte.close();
      servidor.close();
    });

    try {
      await servidor.connect(transporte);
      await transporte.handleRequest(req, res, req.body);
    } catch (e) {
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: e.message },
          id: null,
        });
      }
    }
  });
}
