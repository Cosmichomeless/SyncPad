# syntax=docker/dockerfile:1
# Build from the repository root so @syncpad/shared is in the context:
#   docker build -f backend/Dockerfile -t syncpad-backend .
ARG NODE_IMAGE=node:22.16-alpine

# Production dependencies only. Layout mirrors the repository so that
# backend/node_modules/@syncpad/shared resolves to /app/shared.
FROM ${NODE_IMAGE} AS prod-deps
WORKDIR /app
COPY shared/package.json shared/package-lock.json shared/
COPY backend/package.json backend/package-lock.json backend/
RUN cd shared && npm ci --omit=dev
RUN cd backend && npm ci --omit=dev

FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY shared/package.json shared/package-lock.json shared/
COPY backend/package.json backend/package-lock.json backend/
RUN cd shared && npm ci
RUN cd backend && npm ci
COPY shared/tsconfig.build.json shared/
COPY shared/src shared/src
COPY backend/tsconfig.json backend/tsconfig.build.json backend/
COPY backend/src backend/src
# Compiles @syncpad/shared to shared/dist first, then the server to backend/dist.
RUN cd backend && npm run build

FROM ${NODE_IMAGE} AS runner
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3001
WORKDIR /app/backend
COPY --from=prod-deps --chown=node:node /app/shared/node_modules /app/shared/node_modules
COPY --from=prod-deps --chown=node:node /app/backend/node_modules ./node_modules
COPY --from=build --chown=node:node /app/shared/package.json /app/shared/package.json
COPY --from=build --chown=node:node /app/shared/dist /app/shared/dist
COPY --from=build --chown=node:node /app/backend/dist ./dist
COPY --chown=node:node backend/package.json ./package.json
COPY --chown=node:node backend/migrations ./migrations
COPY --chown=node:node backend/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod 0755 docker-entrypoint.sh
USER node
EXPOSE 3001
HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
# `docker stop` sends SIGTERM; the server closes WebSockets with 1001 and drains HTTP.
STOPSIGNAL SIGTERM
ENTRYPOINT ["./docker-entrypoint.sh"]
