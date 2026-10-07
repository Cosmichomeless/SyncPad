# #62 · Comprobaciones de CI para el backend

## Objetivo

Que cada pull request que toque el servidor de sincronización ejecute en GitHub
Actions lint, tipos, tests, build, migraciones contra PostgreSQL real y una
prueba de la imagen del contenedor, y que un fallo en cualquiera de esos pasos
haga fallar la comprobación.

## Qué se hace

Nuevo workflow `.github/workflows/backend.yml` (Node 22.16, `permissions:
contents: read`, `concurrency` que cancela ejecuciones antiguas de la misma
rama). Dos jobs:

**`checks`** (20 min) con un PostgreSQL 16 efímero como `service` y
`DATABASE_URL` apuntando a él:

1. `npm ci` en `shared/` y `backend/`.
2. `npm run lint` y `npm run typecheck`.
3. `npm test`: pruebas unitarias y de WebSocket con almacén en memoria, que
   incluyen la convergencia tras reinicio (#43).
4. Pruebas del paquete `shared`.
5. `npm run build` y `npm run test:built`: se compila y se arranca `dist/` como
   lo hace `npm start`.
6. `npm run migrate` (desde fuente) y `npm run migrate:built` (compilado) contra
   la base real: una migración que falle sale con 1 y detiene el job.
7. `npm run test:integration --if-present`: las pruebas de PostgreSQL + WebSocket
   de #57. `--if-present` solo existe para que este workflow funcione en ramas
   donde el script todavía no está; una vez integrado #57 se ejecutan siempre.

**`image`** (20 min), también con PostgreSQL efímero:

1. `docker build -f backend/Dockerfile` (#59).
2. Arranca el contenedor con red `host`, espera a que su `HEALTHCHECK` pase a
   `healthy` (el entrypoint aplica las migraciones antes de escuchar) y vuelca
   los logs si no lo hace.
3. `scripts/smoke-stack.mts`: dos sesiones abren la misma nota por WebSocket y
   una edición de una llega a la otra a través del contenedor.
4. `docker stop` y comprobación de que el código de salida es 0 (apagado
   ordenado).
5. Si algo falla, se imprimen los logs del contenedor.

**Disparadores.** `pull_request` y `push` a `main` con filtro de rutas
`backend/**`, `shared/**`, `scripts/**` y el propio workflow; además
`workflow_dispatch`.

## Cómo se verifica

El workflow no se puede ejecutar fuera de GitHub, así que se comprobó por partes:

- `actionlint` (`docker run --rm -v "$PWD":/repo -w /repo rhysd/actionlint`) sin
  avisos, código 0; el YAML carga con PyYAML.
- Se reprodujeron en local los pasos del job `checks` contra un PostgreSQL de
  prueba: `lint`, `typecheck`, `test`, `build`, `test:built`, `migrate` y
  `migrate:built` terminan con código 0.
- Los scripts y ficheros que referencia el workflow existen en la rama
  (`lint`, `typecheck`, `test:built`, `migrate:built`, `backend/Dockerfile`,
  `scripts/smoke-stack.mts`).

## Límites

- El job `image` no se pudo reproducir tal cual en local (usa red `host`, que
  Docker Desktop en macOS no ofrece igual, y el puerto 5432 local estaba
  ocupado). Su primera ejecución real fue en GitHub, en la PR #96, y terminó en
  verde (≈ 48 s). Más tarde se añadió el job `deploy-image` (#67), que sigue el
  mismo esquema para la imagen de despliegue.
- El filtro de rutas hace que el check no aparezca en PRs que no tocan esas
  carpetas; si se marca como obligatorio en la protección de rama, esas PRs
  quedarían en espera (mismo caso que en #61).
- Las acciones se fijan por versión mayor (`@v4`), no por SHA.
- No se ejecuta el e2e de Playwright ni se publica la imagen en un registro.
- Solo Linux x64.
