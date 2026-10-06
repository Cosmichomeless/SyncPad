# #25 — Persistencia local de documentos Yjs en IndexedDB

## Objetivo

Guardar el estado local de cada nota para poder abrirla sin conexión. El
módulo es `frontend/src/lib/note-persistence.ts` y la página lo usa desde
`frontend/src/app/page.tsx` (`persistNote`). Este documento describe el estado
actual consolidado y conserva las decisiones históricas que explican el diseño.

## Criterios de aceptación y evidencia

| Criterio de la issue | Evidencia automática | Cobertura |
| --- | --- | --- |
| Una nota visitada vuelve a abrir tras recargar offline | `note-persistence.test.tsx`: `restores a visited note without network`; `offline-metadata.test.tsx`: visitas y listados cacheados; e2e `offline-reconnection.spec.ts` (recarga completa tras editar sin red) | Capa IndexedDB con tests unitarios reales (Yjs + fake-indexeddb). El recorrido completo en navegador está en el e2e, que necesita Postgres y Chromium |
| Los datos locales están separados por usuario y nota | `isolates two users sharing a note ID`, `isolates two notes belonging to one user`, `storage keys encode user and note IDs unambiguously`; metadata aislada en `offline-metadata.test.tsx` (`orphans are isolated per user`); e2e `account-isolation.spec.ts` | Unitario y e2e |

Ningún criterio carece de test. Las limitaciones de la cobertura se detallan
en el último apartado.

## Comportamiento

- **Clave.** Cada nota vive en una base IndexedDB cuyo nombre es
  `syncpad:note:` seguido de `JSON.stringify([userId, noteId])`. El JSON evita
  colisiones entre pares (usuario, nota) distintos, incluso con separadores en
  los IDs. Dos usuarios que comparten el ID de una nota no comparten datos.
- **Formato.** Versión uno de la base, con un store `updates` de claves
  autoincrementales y un store `custom`. Es el mismo esquema que usaba
  `y-indexeddb` 9.0.12, de modo que se leen los datos existentes sin
  migración (`reads the existing y-indexeddb version-one updates schema`).
  El contenido guardado es un registro append-only de updates de Yjs.
- **Hidratación.** `whenSynced: Promise<void>` rechaza ante errores síncronos o
  asíncronos de apertura, de lectura o abortos de la transacción. Los datos
  solo se aplican al documento cuando la transacción de lectura completa. El
  editor muestra «No se pudo abrir el almacenamiento local» y no inicia el
  socket. Los updates malformados se rechazan y cierran el almacenamiento.
- **Escritura.** El listener de updates se registra después de hidratar. Cada
  update crea una transacción `readwrite` de forma sincrónica y se espera
  hasta `transaction.oncomplete`, no solo hasta el éxito del request. Errores
  y abortos se notifican por `onError` y la UI muestra «No se pudo guardar en
  el almacenamiento local». No se promete conservar un update cuya escritura
  falló.
- **Cierre.** `destroy()` es idempotente: retira el listener, espera la
  hidratación y las escrituras pendientes y cierra la base. Una apertura
  cancelada cierra la base sin aplicar datos.
- **Esquema.** Una copia local escrita por un esquema de documento más nuevo
  se rechaza sin leerla, aplicarla ni reescribirla (ver
  [#35](035-schema-versions.md)).
- **Borrado.** `deleteLocalNote` elimina únicamente la copia local de esa nota
  (`discarding a deleted note erases only that note's local copy`).
- **Alcance.** `persistNote` guarda el documento; el listado de notas, la
  identidad y las visitas se guardan en otros módulos
  ([#30](030-offline-navigation.md)). El shell offline es el
  [#26](026-app-shell.md). La reconexión y la fusión con el servidor son de
  [#31](031-offline-e2e.md).

## Decisiones históricas

1. **IndexedDB nativo en lugar de `y-indexeddb`.** La entrega inicial usaba
   `y-indexeddb`. Su `whenSynced` solo se resuelve con el evento `synced` y la
   cadena interna no maneja rechazos, así que un `catch` en el editor no podía
   gestionar errores de apertura o lectura: quedaba una promesa pendiente y un
   rechazo no manejado. Las pruebas reprodujeron ambos fallos con
   fake-indexeddb antes de cambiar el adaptador (7 pass, 3 fail, 2 cancelled).
   Se sustituyó por un adaptador propio sin campos privados de la dependencia y
   se eliminó `y-indexeddb`; `fake-indexeddb` se conserva para los tests.
2. **Carrera de reapertura inmediata.** Tras 30 ediciones, llamar a
   `destroy()` sin esperarlo y abrir enseguida la misma clave hidrataba un
   documento vacío: la cadena `pending.then` creaba las transacciones
   demasiado tarde y la lectura nueva adelantaba a las escrituras. Antes del
   arreglo: 17 pass, 2 fail. La corrección crea cada transacción `readwrite`
   sincrónicamente; IndexedDB ordena las transacciones conflictivas, también
   entre conexiones a la misma base. Un conjunto de promesas con errores
   tratados registra las escrituras pendientes para `destroy()`. No hay
   coordinación global de claves.

## Verificación

Tests de `frontend/tests/note-persistence.test.tsx` (Yjs y fake-indexeddb
reales, salvo inyección dirigida de fallos):

- Restauración sin red, aislamiento por usuario y por nota, codificación de
  claves e hidratación repetida sin duplicar contenido.
- Cancelación antes de hidratar, durante la apertura y durante la lectura.
- Errores de apertura (factory que lanza, IndexedDB no disponible) y de
  lectura; abortos de escritura antes y después del éxito del request.
- Cola de 30 ediciones exactas (incluido Unicode) y reaperturas inmediatas y
  repetidas de la misma clave sin esperar al cierre anterior.
- Rechazo de updates malformados, compatibilidad con el esquema de
  `y-indexeddb`, borrado local de una nota y rechazo de copias de un esquema
  más nuevo.

`node:test` detecta los rechazos no manejados; la suite no reporta ninguno.

Comando: `cd frontend && npx tsx --test tests/*.test.tsx`. En la sesión de
documentación (Node.js 22, rama apilada sobre `issue/56-accessibility`) la
suite de frontend completa dio 157/157 tests correctos.

Evidencia manual de la entrega original (agente principal, Chromium con
Playwright CLI, frontend compilado y backend local): registro, creación de
workspace y nota desde la UI; edición online; recarga online con la red
bloqueada antes de seleccionar la nota ya listada, con el texto restaurado
exactamente y estado `desconectado`; y almacenamiento denegado mediante una
apertura IndexedDB que lanza `SecurityError`, con el alert
`No se pudo abrir el almacenamiento local` y sin carga pendiente. Aquella
prueba no fue una recarga completa con la red bloqueada; esa parte la cubre el
e2e posterior de [#31](031-offline-e2e.md).

## Límites

- Cobertura de navegador: no hay test unitario de `page.tsx` que ligue la
  hidratación con la UI; esa integración solo se ejerce en los e2e de
  Playwright, que requieren Postgres y Chromium y no se ejecutaron al escribir
  este documento.
- El registro de updates es append-only y no hay compactación en el cliente:
  el uso prolongado de una nota aumenta almacenamiento y tiempo de lectura.
- Los datos locales no se borran al cerrar sesión ni están cifrados. Separar
  las claves por usuario evita mezclas en la aplicación, pero no protege frente
  a quien tenga acceso al perfil del navegador. Política en
  [#52](052-data-isolation.md).
- Si falla una escritura local, esa actualización no se conserva offline
  (se avisa en la UI); no hay reintento.
- Sin IndexedDB disponible (por ejemplo, modos privados restrictivos) la nota
  no se abre y se muestra el error en español.
