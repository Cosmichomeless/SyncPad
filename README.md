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

Solo se entrega la base del frontend y una portada informativa. No hay editor,
autenticación, backend, colaboración ni persistencia offline implementados.

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
