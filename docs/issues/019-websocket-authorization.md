# Issue #19 — Autorización de salas WebSocket

## Alcance

Cuando el servidor tiene autenticación configurada, `/ws` exige `noteId`, cookie
de sesión y membership del usuario en el workspace de la nota antes de ejecutar
`handleUpgrade`. Las conexiones anónimas, IDs inválidos y notas ajenas se
rechazan sin crear cliente WebSocket.

El transporte sin auth sigue disponible para las pruebas de infraestructura
aislada; el entrypoint real siempre conecta auth, notas y seguridad.

## Verificación

```sh
npm --prefix backend test
npm --prefix backend run lint
npm --prefix backend run typecheck
npm --prefix backend run build
```