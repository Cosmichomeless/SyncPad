# SyncPad — Offline Collaborative Workspace
   Proyecto experimental orientado a sistemas en tiempo real y sincronización distribuida.
Objetivo:
Crear un workspace de notas/documentos colaborativos tipo mini Notion/Google Docs que funcione en tiempo real y también offline.
Stack previsto:
- Next.js
- React
- TypeScript
- WebSockets
- IndexedDB
- Yjs o CRDTs
Conceptos a aprender:
- WebSockets
- Real-time systems
- Optimistic UI
- Offline-first
- Eventual consistency
- Sincronización
- Distributed state
- Conflict resolution
- CRDTs
- IndexedDB
- Network failures
Quiero entender realmente cómo se resuelven conflictos cuando dos clientes modifican información mientras alguno está offline.

## Frontend local

Requisitos: Node.js 22.16 o posterior de la rama 22 y npm 10.9 de la rama 10.
El frontend usa Next.js App Router, React y TypeScript estricto. La portada está
en español y utiliza fuentes del sistema, sin servicios externos.

Desde la raíz del repositorio:

```sh
npm --prefix frontend ci
npm --prefix frontend run dev
```

Abrir la dirección local indicada por Next.js (puerto 3000 por defecto).
Para producción local: ejecutar primero build y después start.

```sh
npm --prefix frontend run lint
npm --prefix frontend run typecheck
npm --prefix frontend test
npm --prefix frontend run build
npm --prefix frontend run typecheck
npm --prefix frontend run start
```

### Alcance y verificación de #1

La issue #1 entrega la base del frontend y una portada informativa. No hay editor,
autenticación, colaboración ni persistencia offline implementados todavía.

Verificado con Node 22.16.0 y npm 10.9.2: lint y typecheck sin errores, test de
renderizado real (1/1), build estático correcto y typecheck posterior correcto.
El servidor de desarrollo respondió HTTP 200 con título SyncPad y HTTP 404 para
una ruta desconocida. La revisión visual en navegador no se pudo ejecutar por
ausencia de Chrome en el entorno. Los comandos exactos, resultados y las
incidencias de instalación están en [la entrega de #1](docs/issues/001-frontend.md).

Si el caché npm compartido tiene errores EACCES, se verificó esta alternativa
local (el directorio de caché está ignorado por Git):

```sh
npm --prefix frontend ci --cache frontend/.npm --no-audit --no-fund
```

## Servidor local (#2)

En otra terminal, desde la raíz (Node.js 22.16+ de la rama 22):

```sh
npm --prefix backend ci
npm --prefix backend run dev
```

El backend es un proceso independiente de Next.js. HTTP y WebSocket comparten
el puerto 3001: GET http://127.0.0.1:3001/health responde JSON y
ws://127.0.0.1:3001/ws acepta conexiones. HOST y PORT permiten cambiar la
dirección y puerto; por defecto solo escucha en loopback.

Esta base todavía no autentica conexiones ni sincroniza documentos. No exponer
a Internet; el WebSocket no procesa mensajes de aplicación. El cierre mediante
Ctrl+C o SIGTERM solicita desconexión y fuerza sockets pendientes tras un segundo.

```sh
npm --prefix backend run lint
npm --prefix backend run typecheck
npm --prefix backend test
npm --prefix backend run build
npm --prefix backend start
```

Evidencia y límites: [entrega de #2](docs/issues/002-backend.md).

## PostgreSQL local (#3)

Requisitos adicionales: Docker Desktop con Docker Compose, o PostgreSQL 14 o
posterior instalado localmente.

Para iniciar la base de datos incluida:

```sh
docker compose up -d postgres
```

La conexión local por defecto es
`postgres://syncpad:syncpad@127.0.0.1:5432/syncpad`. El backend acepta una URL
distinta mediante `DATABASE_URL`; `HOST` y `PORT` siguen controlando el servidor
HTTP/WebSocket. La base de datos todavía solo prepara la infraestructura local:
las tablas de aplicación se añadirán mediante las migraciones de #4.

Para detener el servicio sin borrar los datos:

```sh
docker compose stop postgres
```

Para eliminar también el volumen local:

```sh
docker compose down -v
```

## Migraciones de esquema (#4)

Con PostgreSQL iniciado, ejecuta las migraciones desde `backend/`:

```sh
npm --prefix backend run migrate
```

El runner crea `schema_migrations`, aplica los archivos SQL de
`backend/migrations/` en orden lexicográfico y registra cada archivo aplicado
dentro de la misma transacción. Repetir el comando es seguro y no vuelve a
ejecutar migraciones ya registradas.

## Contratos compartidos (#5)

Los tipos públicos viven en `shared/src/index.ts` y se importan desde el backend
y el frontend. Incluyen IDs nominales para usuarios, workspaces y notas, las
respuestas de health/error, resúmenes de entidades y el handshake de sincronización.
La constante `SYNC_PROTOCOL_VERSION` fija la versión inicial del protocolo en `1`.

Estos contratos describen la API pública, pero no representan todavía tablas,
autenticación ni contenido Yjs. Los cambios incompatibles deberán incrementar la
versión del protocolo y documentar la migración.

## Entorno local (#6)

Copia la plantilla antes de iniciar servicios:

```sh
cp .env.example .env
```

`.env` está excluido de Git y `.env.example` solo contiene valores locales de
ejemplo; no se guardan contraseñas reales ni tokens en el repositorio. Para
iniciar PostgreSQL, aplicar migraciones y ejecutar el backend en modo watch:

```sh
./scripts/start-backend-local.sh
```

El frontend se ejecuta en otra terminal con `npm --prefix frontend run dev`.
Para ejecutar las comprobaciones de ambos módulos:

```sh
./scripts/check.sh
```

## Arquitectura y puesta en marcha (#7)

La descripción de componentes, responsabilidades, tipos de estado y flujo local
está en [docs/architecture.md](docs/architecture.md). Distingue explícitamente
los datos persistentes de la presencia efímera y marca qué partes son futuras.

## Usuarios y sesiones (#8)

La migración de acceso crea usuarios con email único y sesiones revocables:

```sh
npm --prefix backend run migrate
```

Las contraseñas se almacenan con `scrypt` y los tokens de sesión solo se guardan
como hashes. Las rutas de registro, login y logout se incorporan en #9; no hay
acceso público seguro hasta completar también #10.

## API de acceso (#9)

Con el backend y las migraciones activos, las rutas disponibles son:

- `POST /auth/register` con `{ "email", "password" }` crea una cuenta e inicia sesión.
- `POST /auth/login` inicia sesión con credenciales existentes.
- `GET /auth/me` devuelve el usuario de la cookie de sesión.
- `POST /auth/logout` revoca la sesión y limpia la cookie.

La cookie es HttpOnly y SameSite=Lax en esta etapa. La política completa para
producción, CSRF y CORS pertenece a #10.

## Workspaces y memberships (#11)

La migración `003-workspaces.sql` crea workspaces y memberships con roles `OWNER`
y `MEMBER`. Crear un workspace asigna automáticamente al creador como `OWNER` y
la pareja workspace/usuario es única.

La API autenticada ofrece `POST /workspaces`, `GET /workspaces` y
`GET /workspaces/:id`; el listado y el detalle solo devuelven memberships del
usuario actual y la creación requiere CSRF.

Los OWNER pueden invitar y eliminar miembros mediante las rutas documentadas en
[docs/issues/013-member-invitations.md](docs/issues/013-member-invitations.md).
Las invitaciones expiran, solo se aceptan una vez y no permiten eliminar al
último OWNER.

## Metadata de notas (#14)

La migración `005-notes.sql` crea notas ligadas obligatoriamente a un workspace,
con título, creador y `updated_at`. Las consultas siempre comprueban membership y
ordenan el listado por modificación reciente; el contenido colaborativo aún no se
guarda aquí.

La API CRUD de notas está documentada en [docs/issues/015-note-crud.md](docs/issues/015-note-crud.md):
los miembros pueden crear/listar y renombrar/borrar notas, mientras que las
operaciones sobre workspaces ajenos se rechazan.

Las invariantes de aislamiento y las pruebas de roles están documentadas en
[docs/issues/017-isolation-tests.md](docs/issues/017-isolation-tests.md).

## Documentos Yjs (#18)

El esquema compartido versionado vive en `shared/src/document.ts`: cada nota
contiene `schemaVersion` y `content`; el título sigue en PostgreSQL. Las
actualizaciones incompatibles se rechazan para permitir migraciones explícitas.

El endpoint WebSocket autoriza la sala mediante cookie de sesión, `noteId` y
membership antes de aceptar el upgrade; este límite está documentado en
[docs/issues/019-websocket-authorization.md](docs/issues/019-websocket-authorization.md).

Las salas intercambian state vectors, snapshots Yjs y actualizaciones
incrementales según [docs/issues/020-yjs-sync.md](docs/issues/020-yjs-sync.md).

Las actualizaciones se reconstruyen desde `syncpad.note_updates` al abrir una
sala y se deduplican por hash, como describe [docs/issues/021-yjs-persistence.md](docs/issues/021-yjs-persistence.md).

La presencia de participantes es efímera y se difunde solo dentro de la sala,
según [docs/issues/023-awareness.md](docs/issues/023-awareness.md).

La prueba de convergencia y reinicio está documentada en
[docs/issues/024-convergence-restart.md](docs/issues/024-convergence-restart.md):
el contenido se restaura, pero la presencia antigua no.

## Cookies, CSRF y CORS (#10)

El origen permitido se configura con `CORS_ORIGIN`. Las mutaciones de acceso
requieren el token de `GET /auth/csrf` en la cookie `syncpad_csrf` y en la cabecera
`X-CSRF-Token`. `COOKIE_SECURE` y `COOKIE_SAME_SITE` controlan los atributos de
las cookies; en producción las cookies Secure se activan por defecto.

## UI de workspace (#16)

La portada permite registrarse, entrar, crear y seleccionar workspaces, y crear,
listar y abrir notas. El editor colaborativo se conectará cuando se complete la
sincronización Yjs de #18–#22.

La edición básica de una nota ya usa el documento Yjs y la sala WebSocket, con
estado de conexión visible; el alcance está en [docs/issues/022-yjs-editor.md](docs/issues/022-yjs-editor.md).

## Persistencia local de notas (#25)

Las notas visitadas conservan su contenido Yjs en IndexedDB mediante
un adaptador nativo, con claves separadas por usuario autenticado y nota y
el esquema previo de updates intacto. El editor hidrata el documento antes
de iniciar el WebSocket. Los errores de apertura/lectura rechazan `whenSynced`
y muestran un error de almacenamiento en español; las escrituras fallidas
también se notifican. El cierre espera las transacciones pendientes y cancela
la hidratación obsoleta sin aplicar datos. Se verificaron 16/16 tests
con persistencia real sobre fake-indexeddb, lint, typecheck, build y typecheck
posterior sin errores (Node.js 22.16.0/npm 10.9.2).

La entrega original no incluía recarga offline completa: dependía del shell
de #26 y de la navegación/metadata de #30 (descrita más abajo). No se
añaden reconexión ni edición desconectada, y la UI autenticada no se ejercitó
en esta verificación. Se sustituyó `y-indexeddb` 9.0.12 tras reproducir sus
rechazos no manejados y su promesa de hidratación pendiente ante errores.
El registro de updates no se compacta automáticamente. #25 sigue
abierta hasta verificar aceptación e integración. Evidencia y límites en
[docs/issues/025-indexeddb.md](docs/issues/025-indexeddb.md).

## Shell anónimo offline (#26, infraestructura)

`npm --prefix frontend run build` genera `public/sw.js` y
`public/offline-shell.html` desde la portada estática de Next. El registro se
activa solo en producción, en un contexto seguro (HTTPS o localhost), y requiere
una primera visita online para instalar el caché. Al perder la red, una
navegación a `/` sin query puede cargar el formulario anónimo y los assets del
build. No se guardan respuestas vivas de la portada, API, auth ni datos privados.

Se verificaron tests del worker ejecutado en VM, lint, typecheck, build/postbuild
y typecheck posterior. La prueba real de control del worker y recarga offline
está pendiente; abrir notas visitadas tras recargar y verificar logout depende
de #30. #26 sigue abierta: no se afirma aceptación offline completa. Evidencia,
política del caché y límites en [docs/issues/026-app-shell.md](docs/issues/026-app-shell.md).

## Navegación offline por usuario (#30)

La portada recupera identidad local y metadata por usuario únicamente ante
fallos de transporte. IndexedDB conserva títulos, workspaces y visitas;
offline solo se ofrecen notas previamente hidratadas. Logout bloquea la UI
local inmediatamente y notifica a otras pestañas, aunque no pueda revocar la
cookie por falta de red. La recarga no desbloquea ese registro: requiere login
explícito. No se guardan contraseñas, tokens ni respuestas HTTP privadas.

Al volver online se valida la sesión y se refrescan resúmenes conservando la
selección, sin recrear el documento Yjs. Las denegaciones no usan fallback y
los recursos conocidos como eliminados/inaccesibles pierden su metadata local.
Un fallo de persistencia/purga bloquea conservadoramente el acceso local para
no reutilizar metadata potencialmente revocada. El caché no es cifrado ni
borrado seguro del perfil compartido.

Verificado con tests automáticos (frontend 57/57, lint, typecheck, build) y con
aceptación en Chromium: recarga offline con contenido restaurado, logout
offline y en dos pestañas, aislamiento entre cuentas y reconexión con metadata
cambiada. #25/#26/#30 siguen abiertas hasta que las cierres. Evidencia en
[docs/issues/030-offline-navigation.md](docs/issues/030-offline-navigation.md).

## Edición local desconectada (#27)

Escribir es local-first: cada cambio se aplica como un splice mínimo sobre
`Y.Text` (sin reemplazar el documento entero) y se guarda en IndexedDB antes de
depender del WebSocket. Sin conexión se puede seguir escribiendo; la UI muestra
un aviso de cambios pendientes y el texto sobrevive a recargas. El envío al
reconectar llega con #28 (ver más abajo). Detalle y evidencia en
[docs/issues/027-local-editing.md](docs/issues/027-local-editing.md).

## Reconciliación al reconectar (#28)

Al volver la red, cada cliente envía su vector de estado Yjs; el servidor
responde con lo que falta y el cliente sube lo que el servidor no tiene. Los
cambios de ambos lados se fusionan (incluidos borrados) y repetir el handshake
no duplica contenido. El servidor solo confirma (`ack`) un update cuando ya es
durable en PostgreSQL, y el cliente solo se declara «al día» tras ese ack. Si
falla el transporte se reintenta con backoff exponencial conservando el
documento local. Detalle y evidencia en
[docs/issues/028-reconnection.md](docs/issues/028-reconnection.md).

## Estado de sincronización (#29)

La cabecera de la nota muestra *Sin conexión*, *Reconectando*, *Sincronizando* o
*Al día* en una única región accesible (`role="status"`), con un punto de color
solo decorativo. «Al día» solo aparece tras el `ack` del servidor. Mientras no
se esté al día hay un botón «Reintentar conexión» que no toca el documento local
(deshabilitado, con motivo, si el navegador no tiene red). Detalle y evidencia en
[docs/issues/029-sync-status.md](docs/issues/029-sync-status.md).

## Pruebas E2E sin red (#31)

`cd e2e && npm run install:browsers && npm test` ejecuta en Chromium dos clientes
reales contra el backend y PostgreSQL: uno pierde la red, edita y recarga sin
conexión mientras el otro sigue editando; al volver la red ambos convergen en el
mismo contenido y en estado *Al día*. Requiere el stack local en `:4000/:4001`
(o lo levanta la propia configuración). Detalle y evidencia, incluida una prueba
de mutación, en [docs/issues/031-offline-e2e.md](docs/issues/031-offline-e2e.md).
