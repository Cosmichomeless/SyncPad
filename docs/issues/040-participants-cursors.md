# #40 · Participantes y cursores

## Objetivo

Que cada persona vea quién está conectado a la nota y qué tiene seleccionado,
con una identidad estable, y que todo ello desaparezca al desconectarse **sin
tocar nunca el documento ni PostgreSQL**.

## Diseño

La presencia es **efímera**: vive solo en la memoria de la sala del servidor
(`room.clients`) y en el estado de React. No se escribe en Yjs, no se persiste y
no cuenta como edición (no genera `update`, no se deshace, no marca cambios
pendientes).

### Protocolo

| Dirección | Mensaje | Significado |
| --- | --- | --- |
| cliente → servidor | `{ type: 'awareness', cursor?: { anchor, head } \| null }` | `cursor` ausente = latido (conserva el actual); `null` = limpiar; objeto = nueva selección |
| servidor → cliente | `{ type: 'awareness', users: AwarenessUser[], self: string }` | lista completa de conexiones de la sala y **el `connectionId` del receptor** |

`AwarenessUser = { connectionId, userId, email, cursor? }`. El servidor emite
la lista al entrar y salir alguien y tras cada cambio de cursor. `self` va por
destinatario, de modo que el cliente sabe cuál de las conexiones es la suya sin
fiarse del correo.

### Cursores como posiciones relativas de Yjs

`anchor` y `head` son `Y.RelativePosition` codificadas en base64, no índices.
Un índice quedaría apuntando a otro texto en cuanto otra persona insertase
delante; una posición relativa sigue al carácter. Cada cliente las resuelve
contra su propia copia (`resolveCursor`) y las recalcula con cada cambio del
contenido. Si no se pueden decodificar o apuntan a otro tipo, se ignoran.

### Identidad estable

- El servidor toma `userId` y `email` de la sesión autenticada, nunca del
  mensaje.
- El color sale de un hash del `userId` (`colorFor`): la misma persona tiene el
  mismo color en todos los dispositivos y sesiones.
- Una persona con varias pestañas o dispositivos aparece **una vez** con
  «· N pestañas» (`groupParticipants`); uno mismo va primero con «(tú)».

### Interfaz

`PresenceBar` muestra los participantes y, para cada selección remota, una
línea con contexto: `ana: …texto <mark>seleccionado</mark> contexto…`. Todo se
renderiza como texto de React (sin HTML de otras personas). El cursor propio se
envía con una espera de 80 ms y se limpia al perder el foco.

## Desconexión

- Al cerrar un socket, el servidor lo retira de la sala y emite la lista nueva.
- Si **tu** conexión se cae, `createNoteSync` avisa con `onAwareness([], null)`:
  la presencia solo tiene sentido conectado, así que no se muestran personas
  que podrían haberse ido.
- Al reconectar se reenvía el cursor actual tras el handshake.

## Validación en servidor

El cursor son dos cadenas base64 no vacías de ≤ 256 caracteres o `null`. Otra
cosa se trata como mensaje inválido (`sync-error` `invalid-message`, cierre
`1003`) sin afectar a los demás clientes de la sala.

## Verificación

- `backend/tests/ws-awareness.test.ts` (+2): el cursor se retransmite, `self`
  difiere por cliente, el latido lo conserva, `null` lo limpia, la salida de un
  cliente lo elimina; cinco cursores malformados se rechazan con `1003`.
- `frontend/tests/presence.test.tsx` (7): color estable, agrupado por usuario,
  desaparición al desconectar, el cursor sigue al texto tras ediciones previas
  y borrado total, cursores ilegibles/ajenos ignorados, selecciones remotas con
  contexto y render escapado.
- `frontend/tests/note-sync.test.tsx` (+1): presencia reenviada, cursor
  recordado y enviado tras el handshake, mensaje malformado ignorado, presencia
  vaciada al caerse el socket.
- `e2e/tests/presence.spec.ts`: dos clientes; participante único con
  «2 pestañas», selección remota resaltada, sigue al texto cuando el otro
  escribe delante y desaparece al cerrar el cliente sin alterar el documento.

## Límites

- No hay caret dibujado sobre el `textarea`: las selecciones remotas se listan
  con contexto. Un overlay exigiría medir el texto por navegador; se revisará
  con el editor definitivo.
- Las pruebas e2e usan una sola cuenta con dos clientes; la presencia de dos
  personas distintas depende de las invitaciones (#41).
- No hay límite de frecuencia en servidor: el cliente espacia los envíos, pero
  un cliente hostil podría inundar de difusiones; se aborda en #48/#53.
- Cada difusión reenvía la lista completa (O(participantes)). Suficiente para
  salas pequeñas.
