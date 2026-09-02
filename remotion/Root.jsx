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
      return {
        fps,
        width: p.saida?.largura || 1080,
        height: p.saida?.altura || 1920,
        durationInFrames: Math.max(1, Math.round((p.fase1?.duracao || 1) * fps)),
      };
    }}
  />
);
