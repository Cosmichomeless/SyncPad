# #60 · Pila completa con Docker Compose

## Objetivo

Levantar PostgreSQL, el servidor de sincronización y la aplicación web con un solo
comando y poder editar una misma nota desde dos navegadores, con volúmenes, red y
health checks definidos, sin romper el flujo de desarrollo actual.

## Qué se hace

`docker-compose.yml` (raíz) pasa de un solo servicio a tres:

| Servicio | Origen | Puerto en el host | Health check | Depende de |
| --- | --- | --- | --- | --- |
| `postgres` | `postgres:16-alpine` | `127.0.0.1:5432` | `pg_isready` | — |
| `backend` | `backend/Dockerfile` (#59) | `127.0.0.1:3001` | `GET /health` | `postgres` sano |
| `frontend` | `frontend/Dockerfile` (#58) | `127.0.0.1:3000` | `GET /` | `backend` sano |

- **Red:** `syncpad`, privada del proyecto. El backend alcanza la base de datos por
  su nombre de servicio (`postgres:5432`); el navegador usa los puertos publicados.
- **Volumen:** `syncpad-postgres` (ya existía; los datos sobreviven a `down`, solo
  `down -v` los borra). El backend y el frontend no guardan estado.
- **Orden de arranque:** `depends_on` con `condition: service_healthy`. El backend
  aplica las migraciones al arrancar (entrypoint de #59) y solo después se declara
  sano, de modo que el frontend nunca se publica antes que su API.
- **Reinicio:** `restart: unless-stopped` en backend y frontend.
- **Flujo de desarrollo intacto:** el servicio y el volumen `postgres` conservan su
  nombre y el puerto 5432, así que `scripts/start-backend-local.sh`
  (`docker compose up -d --wait postgres`) sigue levantando solo la base de datos
  (comprobado: no se construye ni arranca ningún otro servicio). Los puertos se
  publican solo en `127.0.0.1` (antes el de PostgreSQL escuchaba en todas las
  interfaces).

## Configuración

Todo tiene un valor por defecto local; el `.env` de la raíz es opcional (sección
«Docker Compose» de `.env.example`). Compose lee ese mismo `.env` solo para
interpolar las variables de abajo; las del backend de desarrollo (`PORT`, `HOST`,
`DATABASE_URL`…) no se usan, para no mezclar ambos flujos.

| Variable | Por defecto | Efecto |
| --- | --- | --- |
| `POSTGRES_PASSWORD` | `syncpad` | contraseña de la base y de `DATABASE_URL` (solo local; cámbiala fuera de tu máquina) |
| `POSTGRES_PORT` | `5432` | puerto de PostgreSQL en el host |
| `SYNCPAD_WEB_PORT` | `3000` | puerto de la web en el host |
| `SYNCPAD_BACKEND_PORT` | `3001` | puerto de la API/WebSocket en el host |
| `SYNCPAD_WEB_ORIGIN` | `http://127.0.0.1:<SYNCPAD_WEB_PORT>` | `CORS_ORIGIN` del backend; debe coincidir con la URL con la que se abre la web |
| `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_WS_URL` | `http://127.0.0.1:<SYNCPAD_BACKEND_PORT>`, `ws://…/ws` | **argumentos de build** del frontend (ver #58) |
| `COOKIE_SECURE`, `COOKIE_SAME_SITE`, `METRICS_TOKEN` | `false`, `Lax`, vacío | se pasan al backend; `COOKIE_SECURE=false` porque la pila local va por `http` |

Cambiar un puerto del backend o un `NEXT_PUBLIC_*` exige reconstruir el frontend
(`docker compose up --build`), porque esas URLs se incrustan en el bundle.

## Cómo se verifica

```sh
docker compose up -d --build --wait        # los tres servicios en (healthy)
docker compose ps
open http://127.0.0.1:3000                 # abrir con 127.0.0.1, no con localhost

# Prueba de humo por API (dos «navegadores» de la misma cuenta, edición propagada con ack)
cd backend && SYNCPAD_WEB_URL=http://127.0.0.1:3000 npx tsx ../scripts/smoke-stack.mts

docker compose down                        # conserva el volumen
docker compose up -d --wait                # los datos siguen ahí
docker compose down -v                     # borra también el volumen
```

Resultado observado (proyecto `syncpad-b`, puertos 13000/14001/15432):

- `up -d --build --wait` terminó con código 0 y los tres contenedores `healthy`.
- `smoke-stack.mts`: `health`, `frontend: login shell served`,
  `edit: browser A -> persisted (ack) -> browser B received "hello from browser A"`.
- Dos contextos de Chromium (Playwright) contra `http://127.0.0.1:13000`: uno
  registra la cuenta y escribe, el otro inicia sesión, ve el texto, lo edita y el
  primero recibe el cambio; ambos en «Al día».
- El bundle del frontend contiene `127.0.0.1:14001` y ninguna referencia a `:3001`.
- `docker compose down` + `up` conservó los usuarios; `docker compose stop` terminó
  con salida 0 en PostgreSQL y backend.

## Límites

- Pensado para desarrollo y demostración locales: sin TLS ni proxy inverso, con
  contraseña de base de datos por defecto y todo publicado solo en `127.0.0.1`. Un
  despliegue real debe fijar `POSTGRES_PASSWORD`, `COOKIE_SECURE=true`, un
  `SYNCPAD_WEB_ORIGIN` HTTPS y las URLs públicas del build.
- La web debe abrirse con el mismo origen que `SYNCPAD_WEB_ORIGIN`
  (`127.0.0.1`, no `localhost`), o el backend rechaza CORS y el WebSocket.
- El frontend sale con código 143 en `docker compose stop` (el servidor standalone de
  Next no captura `SIGTERM`); no afecta a los datos.
- Defecto previo, ya corregido: `migrate.ts` creaba `schema_migrations` sin cualificar y el
  **segundo** arranque reaplicaba las 8 migraciones (mostraba «Applied 8 migration(s)»).
  Ahora el registro es `public.schema_migrations` y todo arranque posterior al primero
  muestra 0. Una base creada antes del arreglo conserva una `syncpad.schema_migrations`
  huérfana; no se lee y se puede borrar.
- No se ejecuta el e2e de Playwright del repositorio contra esta pila (está atado a
  los puertos 4000/4001 y arranca sus propios servidores).
