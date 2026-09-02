import os from 'node:os';
import path from 'node:path';

export const HOME = os.homedir();
export const RAIZ = path.join(HOME, 'gab-edvid');
export const PROJETOS = path.join(RAIZ, 'projetos');
export const MODELO_WHISPER = path.join(RAIZ, 'models', 'ggml-large-v3-turbo.bin');

// Pasta que o Gabriel usa para jogar o video bruto (igual a "Edicao Edvid" do video).
export const PASTA_ENTRADA = path.join(HOME, 'Desktop', 'Edicao Edvid');

export const PORTA_PREVIEW = 4820;

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
