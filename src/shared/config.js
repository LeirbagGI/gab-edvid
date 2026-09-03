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

// H3 (02/09): `cpus - 1` deixa 1 nucleo de folga pro proprio Node/ffmpeg em
// vez do Chromium tomar todos. No Mac de 10 nucleos as medidas ficaram
// ruidosas e nem sempre `cpus - 1` bateu o `null` de antes (maquina de
// desenvolvimento, com outros processos competindo) — o que importa de
// verdade e a VPS de producao, onde `os.cpus()` do Node le os cores do HOST,
// nao o limite de cgroup do container, entao nem este default automatico
// serve la: o docker-compose.yml fixa `REMOTION_CONCURRENCY` explicito para
// os 3 vCPU reais do container. Este default aqui e so a rede de seguranca
// para quem roda fora do Docker sem setar nada. Ver docs/implementacao/h3-render.md.
export const REMOTION_CONCURRENCY = process.env.REMOTION_CONCURRENCY
  ? Number(process.env.REMOTION_CONCURRENCY) : Math.max(1, os.cpus().length - 1);

// H3: imageFormat 'jpeg' e a recomendacao documentada do proprio Remotion
// para render de video (menos bytes por quadro passando do Chromium pro
// ffmpeg) — no meu benchmark sintetico (testsrc2, faixas de cor lisas, sem
// detalhe fotografico) isso NAO se confirmou: 'png' mediu igual ou mais
// rapido ali, porque PNG comprime area lisa muito bem e o teste nao tem a
// textura de video real onde o PNG fica pesado. Mantive 'jpeg' porque e o
// caso de uso de verdade (filmagem, nao card de teste) e e o que a story
// pediu; qualidade 80 x 90 mediu diferenca de tempo pequena e nenhuma
// diferenca visual que justificasse 90. Ver docs/implementacao/h3-render.md.
export const JPEG_QUALIDADE = Number(process.env.EDVID_JPEG_QUALIDADE) || 80;

// H3: renderizador OpenGL do Chromium headless nos frames do Remotion. Nulo
// deixa o Chrome escolher — no Mac isso usa a GPU de verdade (ANGLE/Metal) e
// e o mais rapido por aqui, entao o default do codigo continua nulo. Na VPS
// (sem GPU nenhuma) esse "escolher sozinho" nao tem hardware pra achar; o
// proprio Remotion ja default para `swangle` (SwiftShader por ANGLE) nos
// renders serverless dele por essa razao, e o CHANGELOG do pacote confirma
// que sem GPU o Chromium cai em SwiftShader de qualquer jeito — so que
// tentando a GPU primeiro, o que arrisca falha/travada de inicializacao em
// container sem GPU nenhuma. Por isso o `EDVID_GL=swangle` fica no
// docker-compose.yml (VPS), nao aqui: e decisao de ambiente, nao de codigo.
export const GL = process.env.EDVID_GL || null;

// Qualidade do render da Fase 2: 'final' (padrao) ou 'prova' (rapido, baixa
// resolucao, so para conferir o resultado antes do render bom). `rodarFase2`
// aceita `{ qualidade }` explicito; isto so decide quando ninguem passa nada.
export const QUALIDADE_PADRAO = process.env.EDVID_QUALIDADE || 'final';

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
  // Nenhum clipe ativo fica menor que isso se puder fundir com um vizinho (H4).
  clipeMinimoS: 1.6,
  // Gap maximo entre falas do mesmo periodo para valer a fusao de clipe curto (H4).
  gapFusaoS: 0.35,
};
