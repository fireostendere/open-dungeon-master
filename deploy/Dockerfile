# Managed installation image: build this private fork, never pull upstream's game image.
FROM node:24-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY scripts/copy-dice-assets.mjs ./scripts/
RUN npm ci && npm install --prefix /opt/odm-codex @openai/codex@0.154.0
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1 NODE_ENV=production PORT=3005 \
    ODM_CODEX_BINARY=/opt/odm-codex/node_modules/@openai/codex/bin/codex.js
RUN npm run build && mkdir -p data models/embeddings public/uploads public/generated public/generated-audio logs /app/provider-auth \
    && chown -R node:node /app
USER node
EXPOSE 3005
# All credentials are supplied at runtime. This image contains no downloaded LLM weights.
ENTRYPOINT ["sh", "/app/scripts/docker-entrypoint.sh"]
CMD ["node", "node_modules/next/dist/bin/next", "start", "-H", "0.0.0.0", "-p", "3005"]
