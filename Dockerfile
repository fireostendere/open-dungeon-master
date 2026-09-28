# syntax=docker/dockerfile:1

# Open Dungeon Master as a single deterministic server image.
# The Next.js build and Open5e content pack are baked in; AI inference is external.
#
# Built on glibc rather than Alpine for the native SQLite/mediasoup dependencies.

# --------------------------------------------------------------- dependencies
FROM node:22.23.2-trixie-slim AS deps
WORKDIR /app

# Toolchain for the two native modules, in case no prebuild matches the platform.
RUN apt-get update \
  && apt-get upgrade -y \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
# The postinstall hook runs this; copy it in before the rest of the source so
# the install layer stays cached across ordinary code changes.
COPY scripts/copy-dice-assets.mjs ./scripts/
# A full install is required for the native runtime dependencies.
RUN npm ci

# --------------------------------------------------------------------- build
FROM deps AS build
WORKDIR /app

# Keep the slow, versioned Open5e pack in a cacheable layer. App source changes
# should not make every deploy download/rebuild this database again.
COPY package.json ./
COPY scripts/fetch-content-pack.mjs scripts/import-open5e.mjs ./scripts/
COPY scripts/lib/open5e-normalize.mjs ./scripts/lib/
COPY src/lib/srd/ ./src/lib/srd/
RUN node scripts/fetch-content-pack.mjs

COPY . .

# 3D dice textures and sounds. The postinstall hook already ran in the deps
# stage; rerunning is cheap and keeps this independent of the COPY order.
RUN node scripts/copy-dice-assets.mjs

ENV NEXT_TELEMETRY_DISABLED=1
RUN DOCKER_BUILD=1 npm run build

# Trim the standalone bundle here, not in the runner stage: deleting a file in a
# later layer does not reclaim the bytes the earlier COPY already wrote.
#
RUN cd .next/standalone \
  && rm -rf node_modules/onnxruntime-node/bin/napi-v6/darwin \
            node_modules/onnxruntime-node/bin/napi-v6/win32 \
            node_modules/onnxruntime-node/bin/napi-v6/linux/arm64 \
  && rm -f  node_modules/onnxruntime-node/bin/napi-v6/linux/x64/libonnxruntime_providers_cuda.so \
            node_modules/onnxruntime-node/bin/napi-v6/linux/x64/libonnxruntime_providers_tensorrt.so \
  && rm -rf data models docs package-lock.json tsconfig.tsbuildinfo \
            README.md CLAUDE.md AGENTS.md eslint.config.mjs postcss.config.mjs

# -------------------------------------------------------------------- runner
FROM node:22.23.2-trixie-slim AS runner
WORKDIR /app

# The patched Debian packages, as in the deps stage; nothing else is
# installed here, so the runner stays the base image plus the app.
RUN apt-get update \
  && apt-get upgrade -y \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3005 \
    CONTENT_DB_PATH=/app/content/open5e.sqlite

# Every COPY sets ownership inline. A trailing `chown -R /app` would rewrite
# every file into a second 250MB layer instead.
#
# The standalone bundle carries its own trimmed node_modules plus server.js.
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public


# The content pack lives outside /app/data so the data volume cannot hide it.
COPY --from=build --chown=node:node /app/data/content/open5e.sqlite ./content/open5e.sqlite

# Source and scripts, so maintenance commands work through `docker compose exec`
# (maintenance scripts import TypeScript from src/).
COPY --from=build --chown=node:node /app/src ./src
COPY --from=build --chown=node:node /app/shared ./shared
COPY --from=build --chown=node:node /app/scripts ./scripts
COPY --from=build --chown=node:node /app/deploy/db-tool.mjs ./deploy/db-tool.mjs
COPY --from=build --chown=node:node /app/tsconfig.json ./tsconfig.json

# Runtime state. Creating these before any volume is attached is what seeds a
# fresh named volume with ownership the unprivileged user can write to.
RUN mkdir -p data models/embeddings public/uploads public/generated public/generated-audio logs provider-auth \
  && chmod +x scripts/docker-entrypoint.sh \
  && chown node:node data models/embeddings public/uploads public/generated public/generated-audio logs provider-auth

USER node
EXPOSE 3005

HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3005)+'/api/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/app/scripts/docker-entrypoint.sh"]
CMD ["node", "server.js"]
