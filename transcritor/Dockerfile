# syntax=docker/dockerfile:1
#
# Sidecar transcritor do Edvid (story C1) — faster-whisper (CTranslate2) em CPU, sem
# GPU, amd64 (mesma VPS do serviço `edvid`, ver ../Dockerfile).
#
# ffmpeg nao entra aqui: o Edvid sempre manda wav 16 kHz mono pronto
# (src/fase1/transcrever.js -> extrairWav), o transcritor so le arquivo.

FROM --platform=linux/amd64 python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .

# Sem baixar modelo no build: a primeira chamada a /transcrever baixa pro volume
# /modelos (HF_HOME, setado no docker-compose) e fica em cache la.
ENV TRANSCRITOR_MODELO=large-v3-turbo \
    TRANSCRITOR_THREADS=3 \
    HF_HOME=/modelos \
    TRANSCRITOR_CACHE=/cache

EXPOSE 4822

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "4822"]
