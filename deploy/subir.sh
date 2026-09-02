#!/usr/bin/env bash
# Sobe o código do Edvid pra VPS do GI e (re)builda o container.
#
# Idempotente: pode rodar quantas vezes quiser. O rsync só manda o que mudou, o
# `docker compose up -d --build` só reconstrói a imagem se algo mudou no contexto de
# build (ou sempre, se você tocou no Dockerfile).
#
# Uso: deploy/subir.sh   (rodar de dentro de codigo/, ou de qualquer lugar — o script
# acha a raiz sozinho pelo caminho dele mesmo)

set -euo pipefail

VPS="root@134.199.251.30"
CHAVE="$HOME/.ssh/gi-vps"
DESTINO_APP="/opt/edvid/app"
DESTINO_DADOS="/opt/edvid/dados"

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> Garantindo pastas em $DESTINO_DADOS na VPS"
ssh -i "$CHAVE" "$VPS" "mkdir -p $DESTINO_DADOS/projetos $DESTINO_DADOS/entrada $DESTINO_DADOS/modelos $DESTINO_DADOS/bundle $DESTINO_APP"

echo "==> Enviando código de $AQUI para $VPS:$DESTINO_APP"
rsync -az --delete \
  --exclude node_modules \
  --exclude projetos \
  --exclude models \
  --exclude .remotion-bundle \
  --exclude .git \
  --exclude .env \
  -e "ssh -i $CHAVE" \
  "$AQUI/" "$VPS:$DESTINO_APP/"

echo "==> Build e subida do container (pode levar vários minutos na primeira vez, compila o whisper.cpp)"
ssh -i "$CHAVE" "$VPS" "cd $DESTINO_APP && docker compose up -d --build"

echo "==> Pronto. Ver logs: ssh -i $CHAVE $VPS 'cd $DESTINO_APP && docker compose logs -f edvid'"
