# Issue #5 — Contratos compartidos

## Alcance

`shared/src/index.ts` contiene los tipos públicos usados por frontend y backend:
IDs nominales, respuestas de health y error, resúmenes de workspace/nota y el
handshake de sincronización. `SYNC_PROTOCOL_VERSION` fija explícitamente la
versión inicial del protocolo en `1`.

El contrato no incluye detalles de almacenamiento ni acopla el editor a
PostgreSQL. Un cambio incompatible debe incrementar la versión y documentar cómo
se actualizan los clientes.

## Verificación

```sh
npm --prefix backend test
npm --prefix backend run lint
npm --prefix backend run typecheck
npm --prefix backend run build
npm --prefix frontend test
npm --prefix frontend run lint
npm --prefix frontend run typecheck
```

La prueba compartida confirma que existe una versión de protocolo explícita y los
typechecks confirman el consumo desde ambos módulos.