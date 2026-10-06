# #61 · Comprobaciones de CI para el frontend

## Objetivo

Que cada pull request que toque `frontend/` ejecute en GitHub Actions lint,
comprobación de tipos, tests y build, y que un error en cualquiera de ellos haga
fallar la comprobación.

## Qué se hace

Nuevo workflow `.github/workflows/frontend.yml` (job `checks`, `ubuntu-latest`,
Node 22.16 como exige `engines`, 15 min de límite, `permissions: contents: read`):

1. `npm ci` en `shared/`, `backend/` y `frontend/`.
2. `npm run lint` (`eslint .`).
3. `npm run typecheck` (`tsc --noEmit`).
4. `npm test` (`tsx --test tests/*.test.tsx`).
5. `npm run build` (`next build` + `postbuild`, que genera el service worker).

Cada paso es un `run` independiente: el primero que sale con código distinto de 0
falla el job y, con él, la comprobación de la PR.

**Disparadores.** `pull_request` y `push` a `main` con filtro de rutas
`frontend/**`, `shared/**`, `backend/**` y el propio workflow; además
`workflow_dispatch`. `concurrency` cancela ejecuciones antiguas de la misma rama.

**Por qué también `shared/` y `backend/`.**

- `@syncpad/shared` es una dependencia `file:../shared` que Next compila desde su
  código fuente y que importa `yjs` desde `shared/node_modules`; hace falta
  `npm ci` allí y un cambio en `shared/` puede romper el frontend.
- `frontend/tests/server-recovery.test.tsx` arranca el servidor real en proceso
  (importa `../../backend/src/*` y `../../backend/node_modules/ws`) y `tsc` también
  comprueba esos ficheros. Sin `npm ci` en `backend/` el paso de tipos falla con
  decenas de errores `TS2307`. Se detectó al reproducir el workflow en una copia
  limpia del repositorio.

**Caché.** `actions/setup-node` cachea npm con los tres `package-lock.json` y
`actions/cache` conserva `frontend/.next/cache` para acelerar el build.

## Cómo se verifica

El workflow no se puede ejecutar fuera de GitHub, así que se comprobó por partes:

- Sintaxis y expresiones: `docker run --rm -v "$PWD":/repo -w /repo rhysd/actionlint`
  → sin avisos, código 0; y el YAML carga con PyYAML.
- Se reprodujeron los mismos comandos sobre una copia limpia (sin `node_modules`,
  `.next` ni ficheros generados) con `npm ci` en `shared`, `backend` y `frontend`:
  lint, typecheck, test (157 pruebas, 0 fallos) y build terminaron con código 0.
- Un test que falla (`assert.equal(1, 2)`) hace que `npm test` salga con 1; un
  error de tipos en `src/` hace que `npm run typecheck` salga con 2 y que
  `npm run build` salga con 1. Es decir, cada tipo de error detiene el job.

## Límites

- El filtro de rutas hace que el check no aparezca en PRs que no tocan esas
  carpetas. Si se marca como «obligatorio» en la protección de rama, esas PRs
  quedarían en espera; hay que decidirlo al configurar la rama (por ejemplo con un
  job agregador sin filtro de rutas).
- Los pasos de la acción (`checkout@v4`, `setup-node@v4`, `cache@v4`) se fijan por
  versión mayor, no por SHA.
- No incluye el e2e de Playwright (requiere PostgreSQL, navegador y los puertos
  4000/4001); el e2e queda fuera de la CI del frontend.
- Solo se ejecuta en Linux x64; no se prueba la compatibilidad con otros sistemas.
