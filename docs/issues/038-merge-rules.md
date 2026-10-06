# #38 · Reglas de fusión y límites

## Objetivo

Dejar escrito qué resuelve Yjs por sí solo y qué reglas siguen siendo decisión
de la aplicación, con enlaces a las pruebas que lo demuestran y se pueden
reproducir.

## Qué resuelve Yjs (sin código propio)

| Situación | Resultado | Prueba reproducible |
| --- | --- | --- |
| Dos clientes insertan en puntos distintos | Ambas inserciones sobreviven | `shared/src/convergence.test.ts`, `frontend/tests/concurrent-text-edits.test.tsx` (#32) |
| Dos inserciones en el **mismo** punto | Orden determinista por `clientID`, igual en todas las réplicas | `convergence.test.ts` (#32) |
| Insertar dentro de un rango que otro borra | El rango se borra; la inserción concurrente sobrevive | `convergence.test.ts` (#32) |
| Borrados idénticos o solapados | Idempotentes; se borra la unión | `convergence.test.ts` (#32) |
| Reemplazo concurrente de la misma palabra | **Ambas versiones** quedan (`perroloro`) | `convergence.test.ts` (#32) |
| Ramas offline divergentes, cualquier orden de reconexión | Mismo texto y misma estructura Yjs | `shared/src/divergent-branches.test.ts` (#33), `backend/tests/ws-reconnection.test.ts` (#28) |
| Entrega duplicada o desordenada de updates | Sin efecto (idempotencia) | `divergent-branches.test.ts` (#33) |
| Secuencias aleatorias de ediciones, desconexiones y recargas | Convergencia, idempotencia, independencia del orden, sin pérdidas | `shared/src/scenarios.test.ts` (#37) |

Para reproducir un escenario aleatorio concreto:

```bash
cd backend && SYNC_SEED=<semilla> npx tsx --test ../shared/src/scenarios.test.ts
```

## Reglas que son de la aplicación

### Texto concurrente

- No hay «última escritura gana» sobre el texto: se fusionan caracteres, no
  versiones del documento.
- **Intención.** Yjs garantiza convergencia, no sentido. Dos reemplazos de la
  misma palabra producen las dos palabras; decidir cuál queda sería una decisión
  de producto (hoy no hay revisión manual ni marcas de conflicto).
- **Índices UTF-16.** El editor convierte el `textarea` en diffs sobre `Y.Text`
  sin partir pares sustitutos (emoji concurrentes cubiertos en #32).
- **Deshacer** solo afecta a ediciones locales; nunca revierte cambios ajenos
  (#36, `frontend/tests/undo-redo.test.tsx`, `e2e/tests/undo-redo.spec.ts`).

### Borrado de notas

- El borrado de una nota es **final** y gana a cualquier edición posterior o
  pendiente: no se recrea ni se resucita desde un cliente (#34,
  `backend/tests/ws-note-deletion.test.ts`).
- El trabajo local sin sincronizar no se pierde en silencio: queda en solo
  lectura con descarga `.txt` (`e2e/tests/delete-while-offline.spec.ts`).

### Permisos

- Los permisos no se fusionan: se **comprueban**. El upgrade WebSocket exige
  sesión y pertenencia al workspace de la nota (#19,
  `backend/tests/ws-auth.test.ts`, `access-isolation.test.ts`).
- Perder el acceso es indistinguible de un borrado para el cliente (`403`), y la
  copia local se conserva (#34).
- El permiso también se **recomprueba en las sesiones ya abiertas** (#51,
  [`051-ws-permissions.md`](051-ws-permissions.md)): antes de procesar un mensaje
  si la última comprobación es más antigua que `SYNC_PERMISSION_RECHECK_MS`
  (defecto 5 s) y en un barrido periódico que alcanza a las conexiones en silencio.
  Quien pierde el acceso recibe el cierre `4403` y sus updates posteriores no se
  guardan (`backend/integration/ws-access.int.test.ts`).

### Cambios de esquema

- El documento lleva `schemaVersion`. Una versión distinta de la propia no se
  fusiona: se rechaza (servidor `incompatible-schema`; cliente, estado terminal
  de solo lectura) y nada se aplica ni se reescribe (#35,
  `backend/tests/ws-schema-compat.test.ts`, `shared/src/document.test.ts`).
- Subir la versión (#39) exige migración explícita; la fusión nunca «degrada» un
  documento más nuevo.

## Límites que conviene conocer

- Los documentos solo crecen: los borrados dejan lápidas hasta que haya
  snapshots y compactación (#44, #45).
- La convergencia es de **estado**; el servidor no ordena operaciones ni da
  «transacciones» entre notas.
- Las propiedades de #37 modelan el protocolo de diff, no la red real; las
  ráfagas y los clientes obsoletos son #47.
- Las marcas del texto enriquecido (#39) se fusionan como los caracteres, pero solo
  se admiten negrita y enlaces válidos: el servidor rechaza el resto (#54,
  [`039-rich-text.md`](039-rich-text.md), [`054-sanitize-rich-text.md`](054-sanitize-rich-text.md)).
