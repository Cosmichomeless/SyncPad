# #33 · Fusión de ramas offline divergentes

## Objetivo

Desconectar varios clientes, editar en cada uno y reconectarlos en distinto
orden, comprobando que la nota converge sin intervención manual y que el
resultado no depende del orden de entrega.

## Diseño

Se reutiliza el arnés de #32 (`shared/src/testing/convergence.ts`) con un
servidor-relay simulado y el handshake real de #28 (`reconnect`: el cliente
recibe lo que le falta y sube lo que el servidor no tiene). Tres clientes
parten del mismo documento y editan zonas distintas sin red (insertar en medio,
borrar una línea, añadir al final).

## Verificación

`shared/src/divergent-branches.test.ts` (7 tests):

- Las 6 permutaciones de orden de reconexión convergen en servidor y clientes
  (misma estructura Yjs, no solo texto) y no pierden ninguna edición.
- Para las 6 permutaciones de llegada de los mismos tres updates el texto es
  **idéntico**: `Lista de compras:\n- cafe\n- pan\n- huevos\n- queso\n`.
- Entrega duplicada y reordenada de los mismos updates no cambia nada
  (idempotencia).
- Edición de la misma línea sin red por dos clientes: conserva ambas versiones y
  elimina el texto borrado.
- Un cliente sin cambios recibe lo que le faltaba; un cliente nuevo bifurcado
  tras la fusión parte del documento fusionado.
- Complementa a `backend/tests/ws-reconnection.test.ts` (#28), que ejecuta la
  convergencia a través del servidor WebSocket real.

## Límites

- El orden entre inserciones en el mismo punto depende del `clientID`; el
  resultado es el mismo en todos los clientes pero no necesariamente el que un
  humano esperaría (ver #38).
- Los clientes simulados no usan red: las ráfagas y los tiempos de reconexión
  se cubren en #47.
