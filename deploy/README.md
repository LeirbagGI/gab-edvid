# Deploy do Edvid na VPS do GI

Container em `/opt/edvid/app` (código) e `/opt/edvid/dados` (volumes: `projetos`,
`entrada`, `modelos`, `bundle`), na VPS `134.199.251.30`, atrás do Traefik que já roteia
`*.gestaoimpacto.com` (rede `gestaoimpacto_web`).

**MVP sem login** (decisão do William, 02/09): o router do Traefik não tem middleware de
autenticação. Não sobe nada sensível na URL pública até isso mudar.

**Domínio:** ainda não há DNS para `editor.gestaoimpacto.com`, então o Host do router em
`docker-compose.yml` usa `editor.134-199-251-30.sslip.io` (resolve sozinho pro IP da VPS,
sem precisar cadastrar nada). Quando o domínio definitivo tiver DNS apontado para a VPS,
troque só o valor dentro de `Host(...)` na label `traefik.http.routers.edvid.rule` e rode
`deploy/subir.sh` de novo.

## Subir

```bash
deploy/subir.sh
```

Manda o código por `rsync` pra `/opt/edvid/app` e roda `docker compose up -d --build`.
Idempotente, pode rodar de novo a qualquer momento. Primeira build compila o
`whisper.cpp` do zero e leva vários minutos; builds seguintes são incrementais.

Depois de subir pela primeira vez, baixe o modelo do whisper (rodar **na VPS**, não
local):

```bash
ssh -i ~/.ssh/gi-vps root@134.199.251.30 "/opt/edvid/app/deploy/baixar-modelo.sh"
```

## Onde estão os dados

| O quê | Onde |
|---|---|
| Projetos, entrada, modelos, bundle | `/opt/edvid/dados/{projetos,entrada,modelos,bundle}` na VPS |
| Código | `/opt/edvid/app` na VPS |
| Overrides de variável de ambiente (opcional) | `/opt/edvid/app/.env` — não existe por padrão |

## Logs

```bash
ssh -i ~/.ssh/gi-vps root@134.199.251.30 "cd /opt/edvid/app && docker compose logs -f edvid"
```

## Rodar um comando dentro do container

```bash
ssh -i ~/.ssh/gi-vps root@134.199.251.30 "cd /opt/edvid/app && docker compose exec edvid node src/cli.js --listar"
```
