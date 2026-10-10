FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    OLLAMA_HOST=127.0.0.1:11434 \
    OLLAMA_MODELS=/var/lib/ollama/models \
    OLLAMA_MODEL=gemma3:4b

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl tini zstd \
    && curl -fsSL https://ollama.com/install.sh -o /tmp/install-ollama.sh \
    && sh /tmp/install-ollama.sh \
    && rm /tmp/install-ollama.sh \
    && mkdir -p /var/lib/ollama/models \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .
RUN chmod +x /app/start.sh

ENTRYPOINT ["tini", "-g", "--", "/app/start.sh"]
