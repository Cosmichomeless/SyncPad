# syntax=docker/dockerfile:1
# Build from the repository root so @syncpad/shared is in the context:
#   docker build -f frontend/Dockerfile -t syncpad-frontend .
ARG NODE_IMAGE=node:22.16-alpine

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY shared/package.json shared/package-lock.json shared/
COPY frontend/package.json frontend/package-lock.json frontend/
RUN cd shared && npm ci
# frontend/node_modules/@syncpad/shared is a symlink to /app/shared, as in the repository.
RUN cd frontend && npm ci

FROM deps AS build
# NEXT_PUBLIC_* values are inlined into the browser bundle and the offline shell at build
# time, so they are build arguments. They are public URLs, never secrets.
ARG NEXT_PUBLIC_API_URL=http://127.0.0.1:3001
ARG NEXT_PUBLIC_WS_URL=ws://127.0.0.1:3001/ws
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL} \
    NEXT_PUBLIC_WS_URL=${NEXT_PUBLIC_WS_URL} \
    NEXT_OUTPUT=standalone \
    NEXT_TELEMETRY_DISABLED=1
COPY shared/src shared/src
COPY frontend/tsconfig.json frontend/next.config.ts frontend/next-env.d.ts frontend/
COPY frontend/scripts frontend/scripts
COPY frontend/src frontend/src
# `npm run build` also runs the postbuild step that generates the offline shell and service worker.
RUN cd frontend && npm run build

FROM ${NODE_IMAGE} AS runner
WORKDIR /app/frontend
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
# The standalone output keeps the monorepo layout (/app/frontend/server.js).
COPY --from=build --chown=node:node /app/frontend/.next/standalone /app
COPY --from=build --chown=node:node /app/frontend/.next/static ./.next/static
COPY --from=build --chown=node:node /app/frontend/public ./public
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT).then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "server.js"]
