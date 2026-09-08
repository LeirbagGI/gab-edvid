# Deploy do Edvid na VPS do GI

Container em `/opt/edvid/app` (código) e `/opt/edvid/dados` (volumes: `projetos`,
`entrada`, `modelos`, `bundle`), na VPS `134.199.251.30`, atrás do Traefik que já roteia
`*.gestaoimpacto.com` (rede `gestaoimpacto_web`).

**C1 — sidecar `transcritor`:** container Python separado (`edvid-transcritor`), só na
rede interna `edvid_internal`, sem porta publicada. `WHISPER_MODO=transcritor` já é o
padrão no `docker-compose.yml` (faster-whisper bateu o whisper.cpp em velocidade e
qualidade — medição em `../docs/implementacao/c1-transcritor.md`); pra voltar ao
`whisper-cli` do serviço `edvid`, comente as duas linhas `WHISPER_MODO`/`TRANSCRITOR_URL`
do serviço `edvid` no compose.

**MVP sem login** (decisão do William, 02/09): o router do Traefik não tem middleware de
autenticação. Não sobe nada sensível na URL pública até isso mudar.

**Domínio:** ainda não há DNS para `editor.gestaoimpacto.com`, então o Host do router em
`docker-compose.yml` usa `editor.134-199-251-30.sslip.io` (resolve sozinho pro IP da VPS,
sem precisar cadastrar nada). Quando o domínio definitivo tiver DNS apontado para a VPS,
troque só o valor dentro de `Host(...)` na label `traefik.http.routers.edvid.rule` e rode
`deploy/subir.sh` de novo.

## Chave de acesso

O `subir.sh` procura a chave em ordem: `$GI_VPS_CHAVE`, `~/.ssh/gi-vps`,
`~/.ssh/id_ed25519`. Se a sua tiver outro nome:

```bash
GI_VPS_CHAVE=~/.ssh/a-sua deploy/subir.sh
```

Ele confere o acesso antes de mexer em qualquer coisa na VPS. Se a chave não
for aceita, autorize a pública correspondente pelo console web da
DigitalOcean (Droplets → Access → Launch Droplet Console):

```bash
mkdir -p ~/.ssh && echo '<conteúdo da sua .pub>' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys
```

Os comandos de diagnóstico abaixo usam `~/.ssh/gi-vps` no exemplo; troque pelo
caminho da chave que você estiver usando.

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

O `transcritor` não precisa desse passo: ele baixa o próprio modelo sozinho (para
`/opt/edvid/dados/modelos-transcritor`) na primeira chamada a `/transcrever` — a primeira
transcrição depois de subir demora mais por causa disso (~1,5 GB pro `large-v3-turbo`
int8), as seguintes usam o modelo já em memória.

## Onde estão os dados

| O quê | Onde |
|---|---|
| Projetos, entrada, modelos, bundle | `/opt/edvid/dados/{projetos,entrada,modelos,bundle}` na VPS |
| Modelo do `transcritor` (baixado sozinho) | `/opt/edvid/dados/modelos-transcritor` na VPS |
| Cache de transcrição por hash do áudio | `/opt/edvid/dados/cache-transcritor` na VPS |
| Código | `/opt/edvid/app` na VPS |
| Overrides de variável de ambiente (opcional) | `/opt/edvid/app/.env` — não existe por padrão |

## Logs

```bash
ssh -i ~/.ssh/gi-vps root@134.199.251.30 "cd /opt/edvid/app && docker compose logs -f edvid"
ssh -i ~/.ssh/gi-vps root@134.199.251.30 "cd /opt/edvid/app && docker compose logs -f transcritor"
```

## Rodar um comando dentro do container

```bash
ssh -i ~/.ssh/gi-vps root@134.199.251.30 "cd /opt/edvid/app && docker compose exec edvid node src/cli.js --listar"
```
