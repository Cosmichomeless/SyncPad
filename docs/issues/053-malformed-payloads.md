# #53 · Pruebas con payloads maliciosos o malformados

## Objetivo

Demostrar que ningún frame hostil o corrupto enviado por un cliente tumba el
servidor, daña a otros clientes de la sala, corrompe el estado persistido ni
filtra contenido o trazas internas.

## Qué se rechaza

| Entrada | Respuesta | Cierre |
| --- | --- | --- |
| Texto vacío, no JSON o JSON truncado | `sync-error` `invalid-message` | `1003` |
| JSON que no es un objeto (`null`, número, cadena, array) | `sync-error` `invalid-message` | `1003` |
| Objeto sin `type` reconocido (`sync-request`, `update`, `awareness`) | `sync-error` `invalid-message` | `1003` |
| Frame binario | `sync-error` `invalid-message` | `1003` |
| `update` sin `payload`, no base64, no Yjs, bytes aleatorios o Yjs truncado | `sync-error` `invalid-message` | `1003` |
| `stateVector` basura | `sync-error` `invalid-message` | `1003` |
| `requestId` numérico, objeto o de más de 128 caracteres | `sync-error` `invalid-message` | `1003` |
| `cursor` que no es objeto, con posiciones inválidas o enormes | `sync-error` `invalid-message` | `1003` |
| Frame mayor que `maxMessageBytes` | cierre por `ws` (`maxPayload`) | `1009` |
| `update` válido que haría superar `maxNoteChars` | `sync-error` `note-too-large` | la sala sigue abierta |

## Cambio en el servidor

Antes un mensaje JSON válido sin tipo conocido no entraba en ninguna rama y se
ignoraba en silencio. Ahora `handle` lo trata como mensaje inválido: debe ser un
objeto plano cuyo `type` sea uno de los tres del protocolo
(`CLIENT_MESSAGE_TYPES`). Un cliente que envía ruido recibe un cierre explícito
en lugar de quedarse conectado consumiendo la sala.

## Garantías verificadas

Para cada caso hostil, `backend/tests/ws-malformed.test.ts` comprueba que:

- solo cae la conexión del emisor; los demás clientes de la misma sala siguen
  abiertos y pueden guardar un cambio con su `ack`;
- no se persiste nada del emisor (exactamente los updates legítimos);
- una sala de otro usuario es independiente y no recibe nada;
- los logs estructurados y las métricas **no contienen** contenido de notas
  (se usa un valor «canario») ni trazas de pila, rutas de `node_modules` o
  referencias `.ts:línea`.

Además hay un test de **fuzz** con mutaciones deterministas (xorshift con semilla
fija, 120 rondas) sobre mensajes válidos: el servidor rechaza una parte, nunca
cierra a los espectadores, sigue sirviendo a la sala y no filtra el canario.

## Límites

- El fuzz es acotado y determinista: no sustituye a una campaña con un fuzzer
  guiado por cobertura.
- La validación de `update` copia el documento para probarlo (#35), con coste
  proporcional al tamaño; el límite `maxMessageBytes` acota el peor caso.
- No se cubren ataques volumétricos más allá de los límites de #48 (tasa,
  tamaño, clientes por sala).
