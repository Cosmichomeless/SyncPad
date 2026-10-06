# #42 · Pulido de la navegación entre workspaces y notas

## Objetivo

Que quede claro qué nota está activa y en qué estado de sincronización se
encuentra, y que cambiar de nota nunca descarte ediciones pendientes.

## Qué cambia

- **Nota activa inequívoca**: la tarjeta activa lleva `aria-current="true"`, un
  marcador visual (`▸`) además del color, y el título de la pestaña pasa a ser
  `«Título» · SyncPad`. Lo mismo para el workspace activo.
- **Estado en la propia lista** (`noteStatusLabel`): la nota activa muestra su
  estado (`Al día`, `Sincronizando`, `Reconectando`, `Sin conexión`, añadiendo
  `· cambios sin enviar` cuando procede); una nota inactiva con ediciones sin
  confirmar muestra `Cambios sin enviar` en negrita y color de aviso; una eliminada,
  `Eliminada en el servidor`. El estado nunca depende solo del color.
- **Sin pérdida al cambiar de nota** (`createDrainRegistry`): al abandonar una nota
  con ediciones que el servidor no ha confirmado, su sesión de sincronización
  **sigue viva en segundo plano** hasta recibir el `ack` y entonces se libera. Así
  las ediciones llegan al servidor aunque el usuario ya esté en otra nota, sin
  tener que volver a abrirla. Los datos siempre quedan además en IndexedDB.
- La región viva de sincronización sigue siendo una sola (la del editor); las
  etiquetas de la lista son texto estático para no duplicar anuncios.

## Garantías y límites

- La sesión en segundo plano se libera al confirmarse todo, si la nota se elimina
  o se vuelve incompatible, al cerrar sesión o desmontar la página, o tras **60 s**
  como máximo (sin red las ediciones siguen guardadas en el dispositivo y se
  enviarán al reabrir la nota).
- Reabrir una nota que aún se está subiendo crea una sesión nueva; ambas envían
  los mismos cambios y la fusión de Yjs es idempotente.
- Tras recargar la página no se conoce qué notas tenían ediciones sin enviar hasta
  abrirlas: el aviso de la lista cubre la sesión actual.

## Verificación

- `frontend/tests/note-navigation.test.tsx` (5): etiquetas de estado, liberación
  única al confirmar, liberación por tiempo y `clear`.
- `e2e/tests/note-navigation.spec.ts`: sin red se edita la nota A, se cambia a B
  (A queda marcada «Cambios sin enviar»), al volver la red un segundo cliente ve
  la edición sin que A se reabra, y al reabrirla en el original sigue ahí.
