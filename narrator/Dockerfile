FROM node:22-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

# Security: run unprivileged
USER node

# Copy application runtime files needed for narrator host
COPY --chown=node:node narrator /app/narrator
COPY --chown=node:node mcp /app/mcp
COPY --chown=node:node shared /app/shared

VOLUME ["/app/state"]

EXPOSE 3007

HEALTHCHECK --interval=15s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3007/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["node", "/app/narrator/run.mjs"]
