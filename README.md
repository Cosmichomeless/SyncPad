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

## Cookies, CSRF y CORS (#10)

El origen permitido se configura con `CORS_ORIGIN`. Las mutaciones de acceso
requieren el token de `GET /auth/csrf` en la cookie `syncpad_csrf` y en la cabecera
`X-CSRF-Token`. `COOKIE_SECURE` y `COOKIE_SAME_SITE` controlan los atributos de
las cookies; en producción las cookies Secure se activan por defecto.
