# #25 — Persistencia local de notas Yjs

## Entrega y decisión basada en evidencia

La entrega inicial (3c545de) usaba y-indexeddb 9.0.12. Su whenSynced solo se
resuelve con el evento synced; la cadena interna _db.then/fetchUpdates no
maneja rechazos. Por tanto, un catch en el editor no podía gestionar errores
de apertura/lectura: dejaba una promesa pendiente y un rechazo no manejado.
Las nuevas pruebas reprodujeron ambos rechazos con fake-indexeddb antes de
cambiar el adaptador (7 pass, 3 fail, 2 cancelled; código 1). Una prueba de
inyección de indisponibilidad tenía inicialmente un mock getter inválido;
se corrigió a una apertura que lanza SecurityError. La cancelación también
mostró una promesa de hidratación pendiente.

Se sustituye el adaptador fino por IndexedDB nativo, sin campos privados de
la dependencia. y-indexeddb se elimina; fake-indexeddb se conserva para tests.
La clave sigue siendo syncpad:note: seguida de JSON [userId, noteId]. Se
conservan la versión uno, updates con autoIncrement y custom; el adaptador
lee las actualizaciones existentes sin migración ni eliminación de datos.

## Comportamiento real

- whenSynced: Promise<void> rechaza por errores síncronos de apertura,
  request.onerror, lectura o aborto de la transacción de lectura. Los datos
  solo se aplican después de completar la transacción. El catch del editor
  muestra «No se pudo abrir el almacenamiento local» y no inicia el socket.
- El listener Yjs de updates se registra después de hidratar. Se guarda el
  estado inicial hidratado y se encolan las actualizaciones posteriores.
- Las escrituras se esperan hasta transaction.oncomplete, no solo el éxito
  del request. Errores y abortos se consumen y notifican mediante onError;
  la UI activa muestra «No se pudo guardar en el almacenamiento local».
  No se promete conservar una actualización cuya escritura falló.
- destroy(): Promise<void> es idempotente, retira el listener inmediatamente,
  espera hidratación y escrituras pendientes, y cierra la base antes de que
  la página destruya el documento. Los errores de hidratación ya observados
  no hacen fallar el cleanup. Un catch interno impide rechazos no manejados
  cuando se cancela sin esperar whenSynced; el consumidor aún recibe su rechazo.
- Una apertura cancelada cierra la base antes de leer/aplicar datos. Si la
  cancelación ocurre durante la lectura, se espera su transacción y no se
  aplica contenido ni se registra el listener. whenSynced se resuelve sin
  aplicar datos en una cancelación exitosa; la página comprueba cancelled.
- Los callbacks de UI quedan protegidos por cancelled. El WebSocket,
  metadata, shell offline y reconexión no se reescriben.

## Verificación ejecutada

Node.js 22.16.0 / npm 10.9.2. Eliminación de dependencia:

`npm --prefix frontend uninstall y-indexeddb --cache /tmp/syncpad-npm-cache --no-audit --no-fund`

Resultado: removed 1 package, código 0.

| Comando desde la raíz | Resultado |
| --- | --- |
| npm --prefix frontend test | 16 tests, 16 pass, 0 fail, 0 cancelled, código 0 |
| npm --prefix frontend run lint | Sin errores, código 0 |
| npm --prefix frontend run typecheck | Sin errores, código 0 |
| npm --prefix frontend run build | Compiled successfully; / y /_not-found estáticas, código 0 |
| npm --prefix frontend run typecheck tras build | Sin errores, código 0 |

Las pruebas usan Yjs y fake-indexeddb reales salvo inyección dirigida de fallos.
Cubren restauración, aislamiento por usuario y nota, claves, hidratación
repetida, cierre durante apertura/lectura, errores síncronos y asíncronos de
apertura, lectura denegada, escritura abortada antes/después del éxito del
request, cola de 30 ediciones exactas (incluido Unicode), cierre idempotente
y compatibilidad del esquema anterior. node:test detecta rechazos no manejados
(como los de la reproducción RED); la suite final no reporta ninguno.

## Límites y revisión pendiente

Esta corrección no ejercitó la UI autenticada ni la recarga offline completa;
el agente principal realiza esa verificación por separado. Las pruebas
verifican el documento local, no la recuperación de toda la aplicación.
El shell offline depende de #26 y la navegación/metadata de #30; /auth/me y
los listados aún requieren red. No se añade edición desconectada ni reconexión.
#25 permanece abierta y las revisiones independientes siguen siendo puerta
previa a publicación.

El registro de updates es append-only, sin compactación automática: el uso
prolongado puede aumentar almacenamiento/tiempo de lectura. Los datos no se
borran al cerrar sesión ni están cifrados; separar claves por usuario no
protege frente a acceso al perfil del navegador. Las modificaciones previas
de tests backend, next-env.d.ts y globals.css quedan fuera de esta entrega.
No se publican cambios ni se cierra la issue.
