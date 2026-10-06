# #32 · Convergencia de ediciones simultáneas de texto

## Objetivo

Demostrar con pruebas que inserciones y borrados simultáneos en dos clientes
terminan en el mismo estado Yjs y que ningún cambio se pierde por una política de
«última escritura gana».

## Diseño

El texto de la nota es un `Y.Text` (CRDT de secuencia): cada carácter tiene una
identidad `(clientID, reloj)`, así que dos ediciones concurrentes se **fusionan**
en lugar de sobrescribirse. No hay código de resolución de conflictos propio; lo
que se prueba es que la integración (diffs por vector de estado, ruta de edición
del `textarea`) preserva esa propiedad.

Arnés reutilizable en `shared/src/testing/convergence.ts` (también para #33 y
#37): pares con un `NoteDocument` real, `deliver`/`exchange`/`settle` que envían
exactamente el diff que falta al receptor (el mismo que usa la reconexión),
`sameYjsState` (igualdad de **snapshot**: estructura y delete set, no solo texto)
y un PRNG con semilla.

## Verificación

- `shared/src/convergence.test.ts` (8 tests): inserciones en la misma posición,
  orden de llegada de dos updates, inserción dentro de un rango que otro borra,
  borrado idéntico y borrados solapados, reemplazo concurrente de la misma
  palabra (ambas versiones sobreviven), escritura intercalada y reintercambio
  idempotente.
- `frontend/tests/concurrent-text-edits.test.tsx` (4 tests) por la ruta real del
  editor (`applyLocalTextEdit`, diff de todo el valor del `textarea`): ediciones
  simultáneas, reemplazo completo frente a inserción en otra zona, borrados de
  palabras distintas y emojis concurrentes sin sustitutos aislados.
- Shared 13/13, frontend lint y typecheck limpios.

## Límites

- Dos inserciones en el **mismo punto** se ordenan de forma determinista por
  `clientID` (ambos clientes ven el mismo orden), pero ese orden no es
  «semántico»; es una regla de Yjs, no de la aplicación.
- Un reemplazo concurrente de la misma palabra conserva ambas versiones
  (las dos palabras quedan en el texto, p. ej. `perroloro`); decidir
  cuál queda es una decisión de producto no resuelta aquí.
