import os from 'node:os';
import path from 'node:path';

// No Mac do Gabriel isto roda sem nenhuma variavel de ambiente: todo default
// abaixo reproduz exatamente o que ja rodava antes. Na VPS o container passa
// as env correspondentes (ver docs/planejamento/architecture.md, secao
// "Container edvid" e "Render").

export const HOME = os.homedir();
export const RAIZ = process.env.EDVID_RAIZ || path.join(HOME, 'gab-edvid');
export const PROJETOS = path.join(RAIZ, 'projetos');

// Pasta que o Gabriel usa para jogar o video bruto (igual a "Edicao Edvid" do video).
export const PASTA_ENTRADA = process.env.EDVID_ENTRADA || path.join(HOME, 'Desktop', 'Edicao Edvid');

export const PORTA_PREVIEW = Number(process.env.EDVID_PORTA) || 4820;

export const MODELO_WHISPER = process.env.WHISPER_MODELO
  || path.join(RAIZ, 'models', 'ggml-large-v3-turbo.bin');

// Transcricao: whisper.cpp local (Mac) por padrao, ou o sidecar Python
// (WHISPER_MODO=transcritor) que a VPS usa.
export const WHISPER_CLI = process.env.WHISPER_CLI || 'whisper-cli';
export const WHISPER_MODO = process.env.WHISPER_MODO || 'cpp';
export const TRANSCRITOR_URL = process.env.TRANSCRITOR_URL || 'http://127.0.0.1:4822';

// Ponte de IA que o cerebro.js chama; roda fora deste container na VPS.
export const PONTE_URL = process.env.PONTE_URL || 'http://127.0.0.1:4821';

// Cache do bundle do Remotion, compartilhado entre projetos.
export const BUNDLE_DIR = process.env.EDVID_BUNDLE || path.join(RAIZ, '.remotion-bundle');

// Codec de render: o Mac tem aceleracao de hardware (VideoToolbox); o
// container Linux da VPS nao, entao cai para libx264 por software.
export const CODEC = process.env.EDVID_CODEC
  || (process.platform === 'darwin' ? 'h264_videotoolbox' : 'libx264');
export const X264_PRESET = process.env.EDVID_X264_PRESET || 'veryfast';
export const CRF = Number(process.env.EDVID_CRF) || 20;
export const REMOTION_CONCURRENCY = process.env.REMOTION_CONCURRENCY
  ? Number(process.env.REMOTION_CONCURRENCY) : null;

// Tempo maximo de cada etapa. Env em segundos (e assim que se pensa em
// timeout); guardado aqui em milissegundos, que e o que o Node usa.
export const TIMEOUTS = {
  ffmpeg: Number(process.env.EDVID_TIMEOUT_FFMPEG || 1800) * 1000,
  whisper: Number(process.env.EDVID_TIMEOUT_WHISPER || 3600) * 1000,
  render: Number(process.env.EDVID_TIMEOUT_RENDER || 3600) * 1000,
};

// Quantas mensagens no modo Claude cada projeto pode gastar. Cada uma custa
// tokens; o modo de comandos fixos e de graca e nao consome essa cota.
export const LIMITE_CHAT = 20;

// Modelo local (Ollama). Nao custa nada e roda offline; e o padrao quando nao
// ha chave da Anthropic. So conta cota o que passa pela API paga.
export const OLLAMA = {
  url: process.env.OLLAMA_URL || 'http://127.0.0.1:11434',
  modelo: process.env.OLLAMA_MODELO || 'qwen2.5:7b',
};

// Extensoes de video aceitas. O ffmpeg lida com todas; nao ha motivo para
// recusar um .avi e deixar o usuario sem saber por que nada aconteceu.
export const EXTENSOES = ['mov', 'mp4', 'm4v', 'avi', 'mkv', 'webm', 'mpg', 'mpeg', '3gp'];
export const RE_VIDEO = new RegExp(`\\.(${EXTENSOES.join('|')})$`, 'i');

// Formato de saida padrao: reel vertical.
export const SAIDA = {
  largura: 1080,
  altura: 1920,
  fps: 30,
};

// Rotulos de bloco que o corte organico atribui a cada fala, na ordem esperada.
export const BLOCOS = ['HOOK', 'DINAMICA', 'RECURSOS', 'CTA'];

// Parametros do corte organico (Fase 1).
export const CORTE = {
  // Silencio maior que isso entre duas falas vira corte.
  silencioMinimoS: 0.2,
  // Folga antes/depois de cada fala para nao cortar em cima da consoante.
  padInicioS: 0.08,
  padFimS: 0.12,
  // Silencio interno tolerado dentro de um bloco antes de virar corte novo.
  pausaInternaMaxS: 0.45,
  // Ganho extra aplicado ao bloco de HOOK.
  ganhoHookDb: 4,
  // Loudness alvo (EBU R128) do audio final.
  lufsAlvo: -14,
};
