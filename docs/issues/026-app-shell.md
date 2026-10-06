# #26 — Caché del shell de la aplicación

## Objetivo

Permitir abrir las rutas esenciales de SyncPad sin red. La aplicación es una
sola página (`/`), por lo que «las rutas esenciales» son el documento raíz y
sus assets estáticos. Este documento describe el estado actual consolidado.

La pieza se reparte en tres capas:

- **Shell anónimo y assets** (esta issue): un service worker generado en el
  postbuild.
- **Notas visitadas** ([#25](025-indexeddb.md)): los documentos Yjs viven en
  IndexedDB por usuario y nota.
- **Identidad, listados y visitas** ([#30](030-offline-navigation.md)):
  metadata privada en IndexedDB y localStorage, no en CacheStorage.

## Criterios de aceptación y evidencia

| Criterio de la issue | Evidencia | Cobertura |
| --- | --- | --- |
| La interfaz y notas ya visitadas se pueden abrir offline | Tests de `service-worker.test.tsx` (shell y assets sin red); `note-persistence.test.tsx` (`restores a visited note without network`); `offline-metadata.test.tsx` (visitas y listados); e2e `offline-reconnection.spec.ts` (recarga completa con el worker controlando la página, vía `waitForServiceWorker`); verificación manual en Chromium del controlador | Unitario por capas y e2e; el e2e no se ejecutó al escribir este documento (necesita Postgres) |
| El caché no muestra datos de una cuenta anterior tras logout | `service-worker.test.tsx` (el worker nunca escribe respuestas vivas ni privadas); `offline-session.test.tsx` (registro bloqueado, generaciones); `offline-metadata.test.tsx` (aislamiento por usuario); e2e `account-isolation.spec.ts`; verificación manual: el shell cacheado no contiene email ni texto de notas | Unitario y e2e, con la política de [#52](052-data-isolation.md) |

## Generación y política

- `npm --prefix frontend run build` ejecuta el postbuild
  (`frontend/scripts/build-service-worker.mjs`). Lee
  `.next/server/app/index.html`, `.next/BUILD_ID` y todos los archivos de
  `.next/static`, y los publica como `/_next/static/...`.
- El generador exige que `/` esté prerenderizada sin revalidación en
  `.next/prerender-manifest.json`, que exista el HTML y que conserve el
  marcador del formulario anónimo (`auth-shell`) sin el de la vista privada
  (`workspace-shell`). Falla de forma cerrada si no se cumple. La portada
  inicia con usuario y listados vacíos y obtiene la identidad en el cliente:
  el HTML del build no contiene datos de cuentas. Si se introduce renderizado
  privado en el servidor, hay que revisar esta invariante antes de ampliar el
  shell.
- `public/sw.js` y `public/offline-shell.html` son generados e ignorados por
  Git. No se debe desplegar un worker o shell de un build distinto al de sus
  assets.
- El caché `syncpad-shell-<BUILD_ID>` precarga solo el HTML anónimo y los
  assets estáticos del mismo origen. La activación elimina únicamente cachés
  antiguos con ese prefijo y reclama clientes; no usa `skipWaiting`.
- El documento raíz usa red primero y cae al shell solo si `fetch` rechaza.
  Un 401/403/404/500 se devuelve intacto, nunca como fallback. Las respuestas
  vivas de `/` no se escriben en CacheStorage. Si falta el shell, se devuelve
  `Response.error()`.
- Los assets incluidos sin query usan caché primero; un miss va a red sin
  escribir la respuesta. No se interceptan la API, auth, rutas privadas, otros
  orígenes, métodos distintos de GET ni solicitudes RSC (cabecera `RSC` o
  parámetro `_rsc`).
- `frontend/src/app/service-worker-registration.tsx`, montado en el layout,
  registra `/sw.js` con scope `/` solo en producción. Requiere HTTPS o
  localhost, soporte de Service Worker y una primera visita online con la
  instalación completada. La actualización sigue el ciclo normal del
  navegador; no se fuerza la sustitución en páginas abiertas.

## Comportamiento tras logout y cambio de cuenta

Estas reglas están en `page.tsx`, `offline-session.ts` y `offline-metadata.ts`
(detalle en [#30](030-offline-navigation.md) y [#52](052-data-isolation.md)):

- Logout limpia al instante usuario, listados, selección y contenido, cierra el
  socket y reemplaza la identidad offline por un registro bloqueado; `/auth/me`
  no lo desbloquea, solo un login o registro explícito.
- El worker nunca guarda respuestas privadas, así que el caché de aplicación
  no puede mostrar datos de la cuenta anterior.
- Los textos y metadatos de la cuenta anterior permanecen en IndexedDB,
  aislados por clave de usuario, sin cifrar. No se muestran a otra cuenta ni
  con sesión cerrada; reaparecen si esa misma cuenta vuelve a iniciar sesión.

## Verificación

Tests de `frontend/tests/service-worker.test.tsx`, que ejecutan el código real
generado en una VM con listeners, `fetch` y CacheStorage simulados:

- `precaches only anonymous shell and declared immutable assets`
- `ignores private, auth, cross-origin, non-GET, Flight and non-root requests`
- `root navigation uses network without caching live responses`
- `root navigation falls back only on network rejection`
- `HTTP errors never become anonymous fallback or cache writes`
- `static cache hits work offline and misses fetch without writing`
- `activation removes only old SyncPad shell caches and claims clients`
- `generator rejects non-anonymous HTML and assets outside immutable build paths`
- `postbuild copies anonymous HTML and maps static files to public Next asset URLs`
- `postbuild fails closed for missing HTML and dynamic or revalidated root output`

Comando: `cd frontend && npx tsx --test tests/*.test.tsx` (157/157 correctos en
la sesión de documentación). Además se ejecutó `npm --prefix frontend run
build` con su postbuild: se generó un shell con `auth-shell`, sin
`workspace-shell`, y 12 assets.

Verificación en navegador de la entrega original (controlador principal,
Chromium con Playwright CLI): tras recargar online, `navigator.serviceWorker.
controller` era verdadero; CacheStorage tenía un único caché SyncPad con 13
entradas (el shell y 12 assets); con la red bloqueada, la recarga completa de
`/` mostraba el formulario de acceso con el worker controlando la página; el
shell cacheado no contenía email ni contenido de nota; no había entradas
`/auth`, `/workspaces` ni `/notes`. El recorrido con notas, aislamiento entre
cuentas y logout lo cubre después el e2e `account-isolation.spec.ts`.

## Límites

- Los tests del worker son unitarios sobre una VM con APIs simuladas. La
  prueba contra un navegador real es manual (arriba) y el e2e de Playwright,
  que necesita Postgres y Chromium, no se ejecutó al documentar.
- No hay test unitario del componente de registro ni de `page.tsx`; ese
  cableado solo se ejerce en los e2e.
- El shell cubre `/` y los assets estáticos del build. Cualquier ruta nueva o
  recurso fuera de `/_next/static/` no está disponible offline.
- La primera visita siempre exige red: sin instalación previa del worker no hay
  shell.
- Las notas y listados offline dependen de IndexedDB y no están cifrados; ver
  los límites de [#25](025-indexeddb.md) y [#52](052-data-isolation.md).
- Con navegador sin Service Worker, o en HTTP no local, la aplicación funciona
  online pero no abre sin red.
