import { Composition } from 'remotion';
import { Reel } from './Reel.jsx';

// Projeto minimo so para o Remotion Studio abrir sem props.
const vazio = {
  nome: 'sem projeto',
  saida: { largura: 1080, altura: 1920, fps: 30 },
  fase1: { arquivo: 'fase1-corte.mp4', duracao: 5, clipes: [] },
  estilo: {
    tipoEdicao: 'limpa', corDestaque: '#EE7533',
    estiloHeadline: 'caixa-branca', estiloLegenda: 'karaoke',
    elementos: {},
  },
  fase2: { headline: '', broll: [], trilha: null },
};

export const Root = () => (
  <Composition
    id="Reel"
    component={Reel}
    defaultProps={{ projeto: vazio }}
    fps={30}
    width={1080}
    height={1920}
    durationInFrames={150}
    calculateMetadata={({ props }) => {
      const p = props.projeto;
      const fps = p.saida?.fps || 30;
      // Duracao total = intro (se houver) + duracao da Fase 1 + o que cada
      // `congelar` por clipe estica a apresentacao (o congelar nao muda
      // `fase1.duracao`, que continua sendo a do arquivo fonte).
      const clipesAtivos = (p.fase1?.clipes || []).filter((c) => c.ativo !== false);
      const extraCongelar = clipesAtivos.reduce((s, c) => s + Math.max(0, c.efeitos?.congelar || 0), 0);
      const introDuracao = p.intro ? (p.intro.duracao || 2.5) : 0;
      const duracaoTotal = (p.fase1?.duracao || 1) + extraCongelar + introDuracao;
      return {
        fps,
        width: p.saida?.largura || 1080,
        height: p.saida?.altura || 1920,
        durationInFrames: Math.max(1, Math.round(duracaoTotal * fps)),
      };
    }}
  />
);
