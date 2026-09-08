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
DESTINO_APP="/opt/edvid/app"
DESTINO_DADOS="/opt/edvid/dados"

# Chave de acesso. Era um caminho fixo para ~/.ssh/gi-vps; no dia em que essa
# chave sumiu do Mac (08/09) o script virou um "permission denied" seco, e nao
# havia como subir correcao nenhuma sem editar o proprio script. Agora tenta,
# em ordem: a que voce mandar por GI_VPS_CHAVE, a gi-vps de sempre, e a chave
# padrao do Mac.
for c in "${GI_VPS_CHAVE:-}" "$HOME/.ssh/gi-vps" "$HOME/.ssh/id_ed25519"; do
  [ -n "$c" ] && [ -f "$c" ] && CHAVE="$c" && break
done

if [ -z "${CHAVE:-}" ]; then
  echo "erro: nenhuma chave ssh encontrada." >&2
  echo "  procurei em: \$GI_VPS_CHAVE, ~/.ssh/gi-vps, ~/.ssh/id_ed25519" >&2
  echo "  rode assim se a sua tiver outro nome: GI_VPS_CHAVE=~/.ssh/a-sua deploy/subir.sh" >&2
  exit 1
fi

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Confere o acesso ANTES de mexer em qualquer coisa: sem isto o primeiro erro
# de chave so aparecia depois do script ja ter criado pasta na VPS.
echo "==> Conferindo acesso a $VPS com $CHAVE"
if ! ssh -i "$CHAVE" -o BatchMode=yes -o ConnectTimeout=10 "$VPS" true 2>/dev/null; then
  echo "erro: $CHAVE nao e aceita por $VPS." >&2
  echo "  autorize a publica correspondente no console web da DigitalOcean:" >&2
  echo "    mkdir -p ~/.ssh && echo '<conteudo de ${CHAVE}.pub>' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys" >&2
  exit 1
fi

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
