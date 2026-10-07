# syntax=docker/dockerfile:1
# One image for the free hosting plan (docs/deployment.md): Caddy on $PORT sends the API and the
# WebSocket to the sync server and everything else to Next.js, so the browser sees one HTTPS origin.
# Build from the repository root:
#   docker build -f deploy/Dockerfile -t syncpad .
ARG NODE_IMAGE=node:22.16-alpine

FROM caddy:2-alpine AS caddy
# The official binary carries the file capability cap_net_bind_service. Hosts that start containers
# without it (Render) refuse to exec it with EPERM, and port $PORT is above 1024, so drop it.
RUN apk add --no-cache libcap-utils \
    && setcap -r /usr/bin/caddy \
    && ! getcap /usr/bin/caddy | grep -q .

# Backend: production dependencies and compiled output (same layout as backend/Dockerfile).
FROM ${NODE_IMAGE} AS backend-prod-deps
WORKDIR /app
COPY shared/package.json shared/package-lock.json shared/
COPY backend/package.json backend/package-lock.json backend/
RUN cd shared && npm ci --omit=dev
RUN cd backend && npm ci --omit=dev

FROM ${NODE_IMAGE} AS backend-build
WORKDIR /app
COPY shared/package.json shared/package-lock.json shared/
COPY backend/package.json backend/package-lock.json backend/
RUN cd shared && npm ci
RUN cd backend && npm ci
COPY shared/tsconfig.build.json shared/
COPY shared/src shared/src
COPY backend/tsconfig.json backend/tsconfig.build.json backend/
COPY backend/src backend/src
RUN cd backend && npm run build

# Frontend: same-origin build. Empty NEXT_PUBLIC_* values mean "ask the page's own origin"
# (frontend/src/lib/endpoints.ts), so the bundle contains no host name and works on any URL.
FROM ${NODE_IMAGE} AS web-build
WORKDIR /app
COPY shared/package.json shared/package-lock.json shared/
COPY frontend/package.json frontend/package-lock.json frontend/
RUN cd shared && npm ci
RUN cd frontend && npm ci
ENV NEXT_PUBLIC_API_URL= \
    NEXT_PUBLIC_WS_URL= \
    NEXT_OUTPUT=standalone \
    NEXT_TELEMETRY_DISABLED=1
COPY shared/src shared/src
COPY frontend/tsconfig.json frontend/next.config.ts frontend/next-env.d.ts frontend/
COPY frontend/scripts frontend/scripts
COPY frontend/src frontend/src
RUN cd frontend && npm run build

FROM ${NODE_IMAGE} AS runner
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=10000 \
    XDG_DATA_HOME=/tmp/caddy-data \
    XDG_CONFIG_HOME=/tmp/caddy-config
WORKDIR /app
COPY --from=caddy /usr/bin/caddy /usr/local/bin/caddy
# Next.js standalone output keeps the monorepo layout (/app/frontend/server.js).
COPY --from=web-build --chown=node:node /app/frontend/.next/standalone /app
COPY --from=web-build --chown=node:node /app/frontend/.next/static ./frontend/.next/static
COPY --from=web-build --chown=node:node /app/frontend/public ./frontend/public
COPY --from=backend-prod-deps --chown=node:node /app/shared/node_modules ./shared/node_modules
COPY --from=backend-prod-deps --chown=node:node /app/backend/node_modules ./backend/node_modules
COPY --from=backend-build --chown=node:node /app/shared/package.json ./shared/package.json
COPY --from=backend-build --chown=node:node /app/shared/dist ./shared/dist
COPY --from=backend-build --chown=node:node /app/backend/dist ./backend/dist
COPY --chown=node:node backend/package.json ./backend/package.json
COPY --chown=node:node backend/migrations ./backend/migrations
COPY --chown=node:node deploy/Caddyfile /etc/caddy/Caddyfile
COPY --chown=node:node deploy/supervisor.mjs ./supervisor.mjs
USER node
EXPOSE 10000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
STOPSIGNAL SIGTERM
# Node is PID 1: it applies migrations, starts the three processes and forwards SIGTERM to them.
CMD ["node", "supervisor.mjs"]
