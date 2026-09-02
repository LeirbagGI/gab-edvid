#!/usr/bin/env bash
# Roda NA VPS (não local). Baixa o modelo do whisper.cpp pra pasta de dados, se ainda não
# estiver lá. Idempotente: se o arquivo já existe, não baixa de novo; se um download
# anterior ficou pela metade, retoma com -C -.

set -euo pipefail

PASTA="/opt/edvid/dados/modelos"
ARQUIVO="$PASTA/ggml-large-v3-turbo.bin"
URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin"

mkdir -p "$PASTA"

if [ -f "$ARQUIVO" ]; then
  echo "==> $ARQUIVO já existe ($(du -h "$ARQUIVO" | cut -f1)), não baixa de novo."
  exit 0
fi

echo "==> Baixando modelo whisper (large-v3-turbo, ~1.5 GB) para $ARQUIVO"
curl -L -C - --fail --retry 5 --retry-delay 5 -o "$ARQUIVO" "$URL"
echo "==> Pronto: $(du -h "$ARQUIVO" | cut -f1)"
