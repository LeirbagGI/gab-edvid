import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { PASTA_ENTRADA } from '../shared/config.js';

/**
 * Upload em pedaços (o 502 de hoje).
 *
 * O Traefik da VPS corta requisição parada com `readTimeout` padrão de 60s, e
 * um POST /api/upload de vídeo grande passa disso fácil — o navegador vê 502,
 * o backend registra "Request aborted". Aqui cada pedaço é uma requisição
 * curta (PUT), e a sessão de upload vive em disco em
 * `PASTA_ENTRADA/.parciais/<id>/` até `finalizar()` montar o arquivo inteiro.
 *
 * Toda função recebe `pasta` (a pasta de entrada) como último argumento
 * opcional, com o padrão de produção (`PASTA_ENTRADA`) — assim o teste injeta
 * uma pasta temporária sem precisar mexer em variável de ambiente.
 */

const PADRAO_PEDACO_MB = 8;

function tamanhoPedacoPadrao() {
  const mb = Number(process.env.EDVID_PEDACO_MB) || PADRAO_PEDACO_MB;
  return mb * 1024 * 1024;
}

const pastaParciais = (pasta) => path.join(pasta, '.parciais');
const pastaSessao = (id, pasta) => path.join(pastaParciais(pasta), id);
const arquivoEstado = (id, pasta) => path.join(pastaSessao(id, pasta), 'estado.json');

function lerEstado(id, pasta) {
  const arq = arquivoEstado(id, pasta);
  if (!fs.existsSync(arq)) {
    throw new Error(`upload: sessão "${id}" não encontrada (expirou, já foi finalizada, ou nunca existiu)`);
  }
  return JSON.parse(fs.readFileSync(arq, 'utf8'));
}

/** Mesmo dedupe do upload direto (multer, em index.js): nunca sobrescreve o que já está na pasta. */
function nomeLivreEntrada(nomeOriginal, pasta) {
  const base = path.basename(nomeOriginal);
  let nome = base;
  let i = 2;
  while (fs.existsSync(path.join(pasta, nome))) {
    const ext = path.extname(base);
    nome = `${path.basename(base, ext)} ${i++}${ext}`;
  }
  return nome;
}

/** Abre uma sessão nova de upload. Devolve o id e o tamanho de pedaço a usar. */
export function iniciar({ nome, tamanho, tipo }, pasta = PASTA_ENTRADA) {
  if (!nome) throw new Error('upload: falta o nome do arquivo');
  const tamanhoNum = Number(tamanho);
  if (!Number.isFinite(tamanhoNum) || tamanhoNum <= 0) throw new Error('upload: tamanho inválido');

  const id = crypto.randomUUID();
  const tamanhoPedaco = tamanhoPedacoPadrao();
  fs.mkdirSync(pastaSessao(id, pasta), { recursive: true });
  fs.writeFileSync(arquivoEstado(id, pasta), JSON.stringify({
    id,
    nome: path.basename(nome),
    tamanho: tamanhoNum,
    tipo: tipo || '',
    tamanhoPedaco,
    criadoEm: new Date().toISOString(),
  }));
  return { id, tamanhoPedaco };
}

/**
 * Grava um pedaço em disco. Idempotente: reenviar o mesmo índice (o
 * navegador retoma depois de queda) sobrescreve o `.part`, nunca duplica —
 * `estado()` conta pedaços por índice de arquivo, não por quantas vezes
 * `receberPedaco` foi chamado.
 */
export function receberPedaco(id, indice, buffer, pasta = PASTA_ENTRADA) {
  const idx = Number(indice);
  if (!Number.isInteger(idx) || idx < 0) throw new Error('upload: índice de pedaço inválido');
  lerEstado(id, pasta); // so para confirmar que a sessao existe antes de gravar

  // Sem isto o fs.writeFileSync abaixo estoura com "The \"data\" argument must
  // be of type string or an instance of Buffer..." — mensagem que nao diz a
  // quem le que o problema foi o corpo da requisicao nao ter chegado.
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('upload: pedaço chegou vazio (corpo da requisição não recebido)');
  }

  const dir = pastaSessao(id, pasta);
  const destino = path.join(dir, `${idx}.part`);
  const tmp = `${destino}.tmp`;
  fs.writeFileSync(tmp, buffer);
  fs.renameSync(tmp, destino); // escrita atomica: um GET de estado() no meio nunca ve pedaco pela metade

  return estado(id, pasta);
}

/** Quais pedaços já chegaram (por índice) e quantos são esperados no total. */
export function estado(id, pasta = PASTA_ENTRADA) {
  const meta = lerEstado(id, pasta);
  const dir = pastaSessao(id, pasta);
  const recebidos = fs.readdirSync(dir)
    .filter((f) => f.endsWith('.part'))
    .map((f) => Number(f.slice(0, -'.part'.length)))
    .sort((a, b) => a - b);
  const total = Math.ceil(meta.tamanho / meta.tamanhoPedaco);
  return { recebidos, total };
}

/**
 * Monta o arquivo final na ordem certa, valida o tamanho contra o que foi
 * declarado em `iniciar()`, e apaga os pedaços. Some pedaço faltando dá erro
 * claro em vez de montar um arquivo corrompido.
 */
export function finalizar(id, pasta = PASTA_ENTRADA) {
  const meta = lerEstado(id, pasta);
  const dir = pastaSessao(id, pasta);
  const { recebidos, total } = estado(id, pasta);

  for (let i = 0; i < total; i += 1) {
    if (!recebidos.includes(i)) throw new Error(`upload: falta o pedaço ${i + 1} de ${total}`);
  }

  fs.mkdirSync(pasta, { recursive: true });
  const nomeFinal = nomeLivreEntrada(meta.nome, pasta);
  const destinoFinal = path.join(pasta, nomeFinal);
  const tmp = `${destinoFinal}.montando.tmp`;

  const fd = fs.openSync(tmp, 'w');
  let bytesEscritos = 0;
  try {
    for (let i = 0; i < total; i += 1) {
      const bloco = fs.readFileSync(path.join(dir, `${i}.part`));
      fs.writeSync(fd, bloco);
      bytesEscritos += bloco.length;
    }
  } finally {
    fs.closeSync(fd);
  }

  if (bytesEscritos !== meta.tamanho) {
    fs.rmSync(tmp, { force: true });
    throw new Error(`upload: tamanho final não confere (esperado ${meta.tamanho}, recebido ${bytesEscritos})`);
  }

  fs.renameSync(tmp, destinoFinal);
  fs.rmSync(dir, { recursive: true, force: true });

  return { caminho: destinoFinal };
}

/** Apaga sessões abandonadas (upload que nunca terminou) mais velhas que `horas`. */
export function limparVelhos(horas = 24, pasta = PASTA_ENTRADA) {
  const raiz = pastaParciais(pasta);
  if (!fs.existsSync(raiz)) return 0;

  const limite = Date.now() - horas * 3600 * 1000;
  let removidos = 0;
  for (const id of fs.readdirSync(raiz)) {
    const dir = path.join(raiz, id);
    let mtimeMs;
    try {
      mtimeMs = fs.statSync(arquivoEstado(id, pasta)).mtimeMs;
    } catch {
      mtimeMs = fs.statSync(dir).mtimeMs;
    }
    if (mtimeMs < limite) {
      fs.rmSync(dir, { recursive: true, force: true });
      removidos += 1;
    }
  }
  return removidos;
}
