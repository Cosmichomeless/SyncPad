# #59 · Imagen de producción del servidor de sincronización

## Objetivo

Empaquetar el servidor Fastify/WebSocket en una imagen de producción que use las
migraciones, exponga un health check, cierre las conexiones de forma controlada y se
configure solo con variables de entorno. Además, corregir el defecto de empaquetado
que impedía arrancar el servidor compilado.

## El defecto de empaquetado

Tras `npm --prefix backend run build`, `npm --prefix backend start` fallaba (Node 22.16):

```text
TypeError [ERR_UNKNOWN_FILE_EXTENSION]: Unknown file extension ".ts" for .../shared/src/index.ts
```

Causa: `@syncpad/shared` exportaba código fuente TypeScript (`"import": "./src/index.ts"`)
y el servidor compilado (`backend/dist`) lo importa en tiempo de ejecución, donde Node
no sabe cargar `.ts`.

## Qué se hace

- **Compilar `@syncpad/shared`.** Nuevo `shared/tsconfig.build.json` y script
  `npm --prefix shared run build` (`tsc` → `shared/dist`, sin tests ni
  `src/testing`). `shared` pasa a tener `typescript` como devDependency
  (lockfile actualizado).
- **Condición de exportación `syncpad-built`.** El mapa `exports` de `shared` queda:
  `types` → `src`, `syncpad-built` → `dist/index.js`, `import`/`default` → `src`.
  Desarrollo, `tsx --test`, Next (`transpilePackages`) y los tipos siguen usando el
  código fuente, sin cambios. Solo el servidor compilado se resuelve a `dist`.
- **`backend` build y start.** `npm --prefix backend run build` compila primero
  `shared` y después el servidor. `npm --prefix backend start` ahora es
  `node --conditions=syncpad-built dist/index.js`. Nuevo `migrate:built`
  (`node dist/migrate.js`).
- **Prueba del punto de entrada compilado.** `backend/tests/entrypoint.test.ts`
  arranca el servidor con los mismos argumentos que `npm start` y comprueba
  `/health`. `npm --prefix backend run test:built` (`SYNCPAD_TEST_BUILT=1`) lo
  ejecuta contra `dist` y se añadió a `scripts/check.sh` justo después del build. Sin
  la variable, la misma prueba usa `src/index.ts` con tsx.
- **`backend/Dockerfile`** (contexto = raíz del repositorio):

  ```sh
  docker build -f backend/Dockerfile -t syncpad-backend .
  ```

  Etapas `prod-deps` (`npm ci --omit=dev` en `shared/` y `backend/`), `build`
  (compila `shared` y el servidor) y `runner` (`node:22.16-alpine`, usuario `node`).
  Mantiene la misma disposición que el repositorio (`/app/shared`,
  `/app/backend`) para que `backend/node_modules/@syncpad/shared` siga siendo un
  enlace al directorio hermano. La imagen solo lleva `dist`, `migrations`,
  `package.json` y dependencias de producción; no hay código fuente, `.env` ni
  datos locales.
- **`backend/docker-entrypoint.sh`.** Aplica las migraciones pendientes
  (`node dist/migrate.js`) y después sustituye el proceso por el servidor con
  `exec`, de modo que Node es PID 1 y recibe `SIGTERM`. Se puede desactivar con
  `SYNCPAD_RUN_MIGRATIONS=false`.
- **Health check.** `HEALTHCHECK` consulta `GET /health` (`{"status":"ok"}`) desde
  dentro del contenedor.
- **Cierre controlado.** `STOPSIGNAL SIGTERM`: el servidor cierra los WebSockets con
  código 1001 «Server shutting down», drena HTTP y cierra el pool de PostgreSQL.
- **`scripts/smoke-stack.mts`.** Prueba de humo contra un stack en marcha: dos
  sesiones (dos «navegadores») de la misma cuenta abren la misma nota por WebSocket,
  una edita y la otra recibe el cambio tras el `ack` de persistencia. Con
  `--wait-close` muestra el código con el que el servidor cierra la conexión.

## Configuración (variables de entorno)

| Variable | Por defecto en la imagen | Notas |
| --- | --- | --- |
| `DATABASE_URL` | obligatoria | `postgres://usuario:clave@host:5432/base`; es un secreto, se inyecta al arrancar |
| `HOST` | `0.0.0.0` | |
| `PORT` | `3001` | entero entre 1 y 65535 |
| `CORS_ORIGIN` | ninguno | origen exacto del frontend (también valida el origen del WebSocket) |
| `COOKIE_SECURE` | `true` con `NODE_ENV=production` | usar `false` solo si se sirve por `http` (local) |
| `COOKIE_SAME_SITE` | `Lax` | |
| `SYNC_*` | ver `.env.example` | límites opcionales de sincronización |
| `METRICS_TOKEN` | sin definir | sin él, `/metrics` responde 404 |
| `SYNCPAD_RUN_MIGRATIONS` | `true` | `false` para ejecutar las migraciones aparte |

La imagen no contiene valores reales: todo llega por `docker run -e` o por el
fichero de entorno. Un valor inválido (por ejemplo `PORT=abc`) detiene el
contenedor con código 1 y un mensaje que no incluye el valor.

## Cómo se verifica

```sh
# 1. Compilado local: el defecto ya no existe
npm --prefix backend run build
npm --prefix backend run test:built        # arranca dist con la orden de `npm start`

# 2. Imagen
docker build -f backend/Dockerfile -t syncpad-backend .
docker network create syncpad-net
docker run -d --name syncpad-pg --network syncpad-net \
  -e POSTGRES_USER=syncpad -e POSTGRES_PASSWORD=syncpad -e POSTGRES_DB=syncpad postgres:16-alpine
docker run -d --name syncpad-be --network syncpad-net -p 127.0.0.1:14001:3001 \
  -e DATABASE_URL=postgres://syncpad:syncpad@syncpad-pg:5432/syncpad \
  -e CORS_ORIGIN=http://127.0.0.1:13000 -e COOKIE_SECURE=false syncpad-backend
docker logs syncpad-be                      # «Applied 8 migration(s)» y «SyncPad listening»
docker ps --filter name=syncpad-be          # (healthy)
curl -s http://127.0.0.1:14001/health       # {"status":"ok"}

# 3. Dos sesiones editan la misma nota
cd backend && SYNCPAD_API_URL=http://127.0.0.1:14001 SYNCPAD_ORIGIN=http://127.0.0.1:13000 \
  npx tsx ../scripts/smoke-stack.mts

# 4. Cierre controlado con un WebSocket abierto
npx tsx ../scripts/smoke-stack.mts --wait-close &   # desde backend/ con las mismas variables
docker stop syncpad-be
#   close: code=1001 reason=Server shutting down ; ExitCode 0
```

Un segundo arranque aplica 0 migraciones (el registro está en `public.schema_migrations`);
«8» solo aparece sobre una base de datos nueva.

## Límites

- `node dist/index.js` sin `--conditions=syncpad-built` sigue fallando con
  `ERR_UNKNOWN_FILE_EXTENSION`: la condición es parte del contrato de arranque
  (`npm start`, el entrypoint de Docker y `test:built` la incluyen).
- Las migraciones se ejecutan en el arranque de cada contenedor. Con varias réplicas
  arrancando a la vez no hay bloqueo consultivo; para eso usar
  `SYNCPAD_RUN_MIGRATIONS=false` en las réplicas y una ejecución única de
  `node dist/migrate.js`.
- La imagen no incluye PostgreSQL ni TLS; Docker Compose (#60) los orquesta y el
  proxy inverso queda fuera.
- Si la base de datos no es alcanzable, el contenedor sale con código 1 (no
  reintenta); el orquestador debe reiniciarlo o esperar a que PostgreSQL esté sano.
