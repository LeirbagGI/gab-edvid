# transcritor

Sidecar de transcrição do Edvid (story C1). Python + FastAPI + faster-whisper
(CTranslate2), roda em CPU, sem GPU. Timestamp por palavra, melhor e mais rápido
que o `whisper-cli` que o serviço `edvid` usa em `WHISPER_MODO=cpp`.

Contrato completo, medição de modelo e a decisão sobre alinhamento por palavra
(whisperx) estão em `../../docs/implementacao/c1-transcritor.md` — leia antes de
mexer no modelo padrão ou de ligar `alinhar=1`.

## API

`GET /saude`
```json
{ "ok": true, "modelo": "large-v3-turbo", "dispositivo": "cpu", "carregado": true }
```

`POST /transcrever` — multipart, campo `audio` (wav 16 kHz mono; é o que
`src/fase1/transcrever.js` manda). Campos opcionais: `idioma` (default `pt`),
`modelo` (default da env `TRANSCRITOR_MODELO`), `alinhar` (`0`/`1`, default a
env `TRANSCRITOR_ALINHAR_PADRAO`, hoje `0` — ver o porquê no doc de
implementação).

```json
{
  "palavras": [{ "inicio": 0.0, "fim": 0.24, "texto": "Olá,", "confianca": 0.99 }],
  "segmentos": [{ "inicio": 0.0, "fim": 3.1, "texto": "Olá, tudo bem?" }],
  "idioma": "pt",
  "modelo": "large-v3-turbo",
  "duracao_s": 29.2,
  "tempo_s": 13.7
}
```

O `transcrever.js` só lê `palavras`; o resto é informativo (log, depuração,
`comparar-transcricao.mjs`).

## Variáveis de ambiente

| Variável | Default | Para quê |
|---|---|---|
| `TRANSCRITOR_MODELO` | `large-v3-turbo` | modelo padrão quando o pedido não passa `modelo` |
| `TRANSCRITOR_THREADS` | `3` | `cpu_threads` do CTranslate2 |
| `TRANSCRITOR_ALINHAR_PADRAO` | `0` | se `alinhar` não vem no pedido, usa este valor |
| `HF_HOME` | `/modelos` | onde o faster-whisper baixa e cacheia os modelos (huggingface hub) |
| `TRANSCRITOR_CACHE` | `/cache` | pasta do cache por hash do áudio |

## Cache

Cada pedido é hasheado (sha256 do wav recebido); se já existe
`<TRANSCRITOR_CACHE>/<hash>.json`, devolve na hora sem transcrever de novo. Útil
quando o Edvid reprocessa o mesmo bruto (refazer corte, etc).

## Fila

Um pedido por vez: um lock trava a etapa de transcrição/alinhamento, então
pedidos concorrentes esperam a vez (não derrubam o processo, só filam). Timeout
de fila de 60 min — nunca deve chegar perto disso na prática.

## Alinhamento por palavra (whisperx)

O código de alinhamento existe (`_alinhar()` em `app.py`) mas o `whisperx` **não
está** em `requirements.txt` por padrão: a medição da story (ver doc de
implementação) achou pico de ~2,3 GB de RAM e o dobro do tempo total contra só
o faster-whisper, para uma melhora de precisão de timestamp não comprovada
neste teste. Pra ligar:

1. Descomente a linha do `whisperx` em `requirements.txt`.
2. Rebuilda a imagem (`docker compose build transcritor`).
3. Mande `alinhar=1` no pedido, ou suba `TRANSCRITOR_ALINHAR_PADRAO=1`.

Sem isso, `alinhar=1` no pedido é ignorado silenciosamente (log avisa) e o
resultado sai só do faster-whisper.

## Rodar fora do Docker (dev/teste)

```bash
python3.11 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
HF_HOME=./modelos TRANSCRITOR_CACHE=./cache uvicorn app:app --port 4822
```
