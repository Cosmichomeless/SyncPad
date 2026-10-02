# Issue #22 — Editor básico conectado a Yjs

## Alcance

Al seleccionar una nota, el frontend crea el documento Yjs, abre la sala
`/ws?noteId=...`, aplica el snapshot recibido y muestra el contenido en un
textarea. Cada edición reemplaza el texto local de forma transaccional y envía
una actualización Yjs; los mensajes remotos actualizan el mismo editor sin
recargar la página.

El título sigue siendo metadata relacional y el indicador de conexión distingue
conectando, conectado y desconectado. Cursores y awareness quedan para #23.

## Verificación

```sh
npm --prefix frontend test
npm --prefix frontend run lint
npm --prefix frontend run typecheck
npm --prefix frontend run build
```