"""Sidecar de transcricao do Edvid (story C1).

FastAPI + faster-whisper (CTranslate2) rodando em CPU, com timestamp por
palavra e VAD embutido (silero). Alinhamento fino opcional via whisperx —
ver README.md e ../../docs/implementacao/c1-transcritor.md para a medicao
que decidiu se ele fica ligado por padrao.

Contrato consumido por src/fase1/transcrever.js (WHISPER_MODO=transcritor):
POST /transcrever devolve pelo menos `{ palavras: [{inicio, fim, texto}] }`
em segundos — o resto dos campos e informativo, o cliente Node so le
`palavras`.
"""
import hashlib
import json
import logging
import os
import tempfile
import time
from pathlib import Path
from threading import Lock

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from faster_whisper import WhisperModel

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s transcritor: %(message)s')
log = logging.getLogger('transcritor')

MODELOS_DIR = Path(os.environ.get('HF_HOME', '/modelos'))
CACHE_DIR = Path(os.environ.get('TRANSCRITOR_CACHE', '/cache'))
CACHE_DIR.mkdir(parents=True, exist_ok=True)
MODELOS_DIR.mkdir(parents=True, exist_ok=True)

MODELO_PADRAO = os.environ.get('TRANSCRITOR_MODELO', 'large-v3-turbo')
THREADS = int(os.environ.get('TRANSCRITOR_THREADS', '3'))

# Ligado ou desligado por padrao: decidido pela medicao em
# docs/implementacao/c1-transcritor.md, nao pelo pedido em si — o campo
# `alinhar` do pedido continua existindo e sempre pode forcar 0 ou 1.
ALINHAR_PADRAO = os.environ.get('TRANSCRITOR_ALINHAR_PADRAO', '0') == '1'

# Fila de 1 pedido por vez; nunca deve chegar perto disso — e so o teto pra
# nao segurar um cliente HTTP pra sempre se algo travar.
TIMEOUT_FILA_S = 60 * 60

# Pontuacao e acento em pt-BR: sem isso o faster-whisper tende a devolver
# tudo em minuscula e sem virgula (medido nos testes locais da story).
INITIAL_PROMPT = 'Olá, tudo bem? Hoje eu vou te mostrar.'

try:
    import whisperx  # noqa: F401  (so testa se a lib esta instalada nesta imagem)
    ALINHAR_DISPONIVEL = True
except ImportError:
    ALINHAR_DISPONIVEL = False

app = FastAPI(title='transcritor')

_fila = Lock()
_modelos: dict[str, WhisperModel] = {}
_align_cache: dict[str, tuple] = {}

# O modelo int8 ocupa ~2 GB residente. A VPS tem ~4 GB livres e o render do
# Edvid precisa de mais de 1 GB, então o modelo é descarregado depois de
# TRANSCRITOR_OCIOSO_S sem uso (default 10 min); a próxima chamada recarrega
# (custo: ~5 a 15 s). Zero desliga a descarga.
OCIOSO_S = int(os.environ.get('TRANSCRITOR_OCIOSO_S', '600'))
_ultimo_uso = time.time()


def _vigia_ocioso():
    import gc
    while True:
        time.sleep(30)
        if OCIOSO_S and _modelos and time.time() - _ultimo_uso > OCIOSO_S and not _fila.locked():
            log.info('descarregando modelos por ociosidade (%d s)', OCIOSO_S)
            _modelos.clear(); _align_cache.clear(); gc.collect()


import threading as _th
_th.Thread(target=_vigia_ocioso, daemon=True).start()


def carregar_modelo(nome: str) -> WhisperModel:
    if nome not in _modelos:
        log.info('carregando modelo %s (threads=%d)', nome, THREADS)
        t0 = time.time()
        _modelos[nome] = WhisperModel(
            nome,
            device='cpu',
            compute_type='int8',
            cpu_threads=THREADS,
            download_root=str(MODELOS_DIR),
        )
        log.info('modelo %s carregado em %.1fs', nome, time.time() - t0)
    return _modelos[nome]


def carregar_align(idioma: str):
    if idioma not in _align_cache:
        import whisperx
        log.info('carregando modelo de alinhamento (%s)', idioma)
        t0 = time.time()
        modelo_a, metadata = whisperx.load_align_model(language_code=idioma, device='cpu')
        log.info('modelo de alinhamento carregado em %.1fs', time.time() - t0)
        _align_cache[idioma] = (modelo_a, metadata)
    return _align_cache[idioma]


@app.get('/saude')
def saude():
    return {
        'ok': True,
        'modelo': MODELO_PADRAO,
        'dispositivo': 'cpu',
        'carregado': MODELO_PADRAO in _modelos,
        'alinhamento_disponivel': ALINHAR_DISPONIVEL,
        'alinhamento_padrao': ALINHAR_PADRAO,
    }


@app.post('/transcrever')
def transcrever(
    audio: UploadFile = File(...),
    idioma: str = Form('pt'),
    modelo: str | None = Form(None),
    alinhar: str | None = Form(None),
):
    global _ultimo_uso
    _ultimo_uso = time.time()
    nome_modelo = modelo or MODELO_PADRAO
    quer_alinhar = (alinhar if alinhar is not None else ('1' if ALINHAR_PADRAO else '0')) == '1'
    if quer_alinhar and not ALINHAR_DISPONIVEL:
        log.warning('alinhar=1 pedido mas whisperx nao esta instalado nesta imagem, ignorando')
        quer_alinhar = False

    dados = audio.file.read()
    if not dados:
        raise HTTPException(400, 'audio vazio')

    sha = hashlib.sha256(dados).hexdigest()
    cache_path = CACHE_DIR / f'{sha}.json'
    if cache_path.exists():
        log.info('cache hit %s', sha[:12])
        return JSONResponse(json.loads(cache_path.read_text()))

    with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as f:
        f.write(dados)
        caminho = f.name

    if not _fila.acquire(timeout=TIMEOUT_FILA_S):
        os.unlink(caminho)
        raise HTTPException(503, 'fila do transcritor cheia, tenta de novo')
    try:
        resultado = _transcrever_arquivo(caminho, nome_modelo, idioma, quer_alinhar)
        _ultimo_uso = time.time()
    except Exception as e:
        log.exception('falha ao transcrever %s', sha[:12])
        raise HTTPException(500, f'falha ao transcrever: {e}') from e
    finally:
        _fila.release()
        os.unlink(caminho)

    cache_path.write_text(json.dumps(resultado, ensure_ascii=False))
    return JSONResponse(resultado)


def _transcrever_arquivo(caminho, nome_modelo, idioma, quer_alinhar):
    t0 = time.time()
    modelo_w = carregar_modelo(nome_modelo)
    segmentos_iter, info = modelo_w.transcribe(
        caminho,
        language=idioma,
        beam_size=5,
        word_timestamps=True,
        vad_filter=True,
        vad_parameters={'min_silence_duration_ms': 300},
        condition_on_previous_text=False,
        initial_prompt=INITIAL_PROMPT,
    )

    segmentos = []
    palavras = []
    for s in segmentos_iter:
        segmentos.append({'inicio': s.start, 'fim': s.end, 'texto': s.text.strip()})
        for w in (s.words or []):
            palavras.append({
                'inicio': w.start,
                'fim': w.end,
                'texto': w.word.strip(),
                'confianca': round(float(w.probability), 4),
            })

    if quer_alinhar:
        try:
            palavras_alinhadas, segmentos_alinhados = _alinhar(caminho, segmentos, idioma)
            if palavras_alinhadas:
                palavras, segmentos = palavras_alinhadas, segmentos_alinhados
        except Exception:
            log.exception('alinhamento falhou, mantendo timestamps do faster-whisper')

    return {
        'palavras': palavras,
        'segmentos': segmentos,
        'idioma': info.language,
        'modelo': nome_modelo,
        'duracao_s': info.duration,
        'tempo_s': round(time.time() - t0, 2),
    }


def _alinhar(caminho, segmentos, idioma):
    import whisperx

    modelo_a, metadata = carregar_align(idioma)
    audio_np = whisperx.load_audio(caminho)
    entrada = [{'start': s['inicio'], 'end': s['fim'], 'text': s['texto']} for s in segmentos]
    alinhado = whisperx.align(entrada, modelo_a, metadata, audio_np, 'cpu')

    palavras = []
    for seg in alinhado['segments']:
        for w in seg.get('words', []):
            if 'start' not in w:  # whisperx as vezes deixa palavra de ruido sem tempo
                continue
            palavras.append({
                'inicio': w['start'],
                'fim': w['end'],
                'texto': w['word'].strip(),
                'confianca': round(float(w.get('score', 0)), 4),
            })
    segs_saida = [
        {'inicio': s['start'], 'fim': s['end'], 'texto': s['text'].strip()}
        for s in alinhado['segments']
    ]
    return palavras, segs_saida
