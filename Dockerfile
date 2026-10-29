# syntax=docker/dockerfile:1

# ── Build stage ────────────────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# ── Runtime stage ──────────────────────────────────────────────────────────
FROM node:22-alpine

LABEL org.opencontainers.image.title="cnb-remote-mcp"
LABEL org.opencontainers.image.description="Unofficial, self-hosted Remote MCP Server for CNB.cool"
LABEL org.opencontainers.image.source="https://cnb.cool/htazq/cnb-remote-mcp"
LABEL org.opencontainers.image.licenses="MIT"

RUN apk add --no-cache git ca-certificates && addgroup -S app && adduser -S app -G app
WORKDIR /app

ENV NODE_ENV=production \
    MCP_DATA_DIR=/app/data \
    MCP_HTTP_HOST=0.0.0.0 \
    MCP_HTTP_PORT=3000

COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/dist ./dist
COPY --chown=app:app package.json ./

RUN mkdir -p /app/data && chown app:app /app/data

USER app
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${MCP_HTTP_PORT}/healthz" || exit 1

# Default: HTTP transport. For STDIO, override the command:
#   docker run image node dist/index.js
ENTRYPOINT ["node"]
CMD ["dist/http.js"]
