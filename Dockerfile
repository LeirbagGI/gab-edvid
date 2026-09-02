# syntax=docker/dockerfile:1
#
# Edvid — container Linux (story A2). Duas etapas:
#   1. whisper  — compila o whisper.cpp (whisper-cli + libs), sem CUDA.
#   2. final    — node:22-bookworm com ffmpeg, Chrome do Remotion e fontes do projeto.
#
# amd64 apenas (é o que a VPS do GI roda). Build: `docker compose build` a partir de
# `codigo/` (ver deploy/subir.sh).

FROM --platform=linux/amd64 debian:bookworm-slim AS whisper

# Tag fixa: verificada em 2026-09-02 com `git ls-remote --tags`, é a mais recente estável
# (v1.9.3, série pós v1.7.x pedida na spec). Trocar aqui quando quiser atualizar.
ARG WHISPER_TAG=v1.9.3

RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential cmake git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src
RUN git clone --depth 1 --branch ${WHISPER_TAG} https://github.com/ggml-org/whisper.cpp.git .

# BUILD_SHARED_LIBS=ON: precisamos das .so (libwhisper, libggml*) além do binário
# whisper-cli, para copiar tudo junto no estágio final. Sem CUDA (GGML_CUDA=OFF), a VPS
# não tem GPU.
RUN cmake -B build -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=ON -DGGML_CUDA=OFF -DWHISPER_CURL=OFF \
    && cmake --build build -j"$(nproc)" --config Release


FROM --platform=linux/amd64 node:22-bookworm AS final

# ffmpeg + fontconfig (fontes) + curl (healthcheck) + libs do Chrome headless que o
# Remotion usa para renderizar (Fase 2). Lista vem da spec da story A2.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg fontconfig curl \
      libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 \
      libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2 \
      libpango-1.0-0 libcairo2 libxshmfence1 fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

# whisper-cli e as .so que ele precisa (libwhisper + libggml*), do estágio anterior.
# Nota: na v1.9.3 o cmake do whisper.cpp joga TODO output (binário e libs) em
# build/bin/, não em build/src/ e build/ggml/src/ como versões mais antigas — conferido
# com `ldd whisper-cli` na VPS. libparakeet.so* fica pra trás de propósito: whisper-cli
# não depende dela (é de um backend ASR experimental à parte).
COPY --from=whisper /src/build/bin/whisper-cli /usr/local/bin/whisper-cli
COPY --from=whisper /src/build/bin/libwhisper.so* /usr/local/lib/
COPY --from=whisper /src/build/bin/libggml.so* /usr/local/lib/
COPY --from=whisper /src/build/bin/libggml-base.so* /usr/local/lib/
COPY --from=whisper /src/build/bin/libggml-cpu.so* /usr/local/lib/
RUN ldconfig

# Fontes do projeto (títulos/legendas dos reels), no sistema para o Chrome do Remotion
# enxergar — não dá para depender de fonte instalada na máquina do Gabriel.
RUN mkdir -p /usr/share/fonts/truetype/edvid
COPY public/fontes/*.ttf /usr/share/fonts/truetype/edvid/
RUN fc-cache -f

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .

# Baixa o Chrome que o Remotion usa para renderizar, já no build da imagem — sem isso o
# primeiro render na VPS ia baixar (ou falhar) em runtime.
RUN npx remotion browser ensure

# Defaults; documentados em ../docs/planejamento/architecture.md. `config.js` (A1) lê
# tudo daqui, com fallback pro comportamento de hoje quando roda fora do container.
ENV EDVID_RAIZ=/dados \
    EDVID_ENTRADA=/dados/entrada \
    EDVID_PORTA=4820 \
    WHISPER_MODELO=/dados/modelos/ggml-large-v3-turbo.bin \
    WHISPER_CLI=/usr/local/bin/whisper-cli \
    WHISPER_MODO=cpp \
    EDVID_BUNDLE=/dados/bundle \
    EDVID_CODEC=libx264 \
    EDVID_X264_PRESET=veryfast \
    EDVID_CRF=20 \
    PONTE_URL=http://host.docker.internal:4821 \
    TRANSCRITOR_URL=http://transcritor:4822 \
    NODE_ENV=production

EXPOSE 4820

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -f http://127.0.0.1:4820/api/fila || exit 1

CMD ["node", "src/server/index.js"]
