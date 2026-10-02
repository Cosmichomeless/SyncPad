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
