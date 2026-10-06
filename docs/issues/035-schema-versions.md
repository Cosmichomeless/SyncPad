# #35 · Versiones de esquema y compatibilidad entre clientes

## Objetivo

Que un cliente (o servidor) con un esquema de documento más antiguo nunca
corrompa, sobrescriba ni reinterprete una nota escrita con un esquema más
nuevo, y que el usuario sepa qué ha pasado y cómo recuperarse.

## Política de versiones

- El documento de una nota es un `Y.Map` `note` con `schemaVersion` y un
  `Y.Text` `content`. La versión actual es **1** (`DOCUMENT_SCHEMA_VERSION`).
- **Cambios aditivos** (campos nuevos que un cliente antiguo puede ignorar sin
  perder información) mantienen la versión.
- **Cambios incompatibles** (otro tipo para `content`, nueva estructura, texto
  enriquecido del #39…) suben `DOCUMENT_SCHEMA_VERSION`. Un esquema distinto del
  propio se trata como ilegible, nunca como «casi igual».
- `schemaVersion` se crea de forma **determinista**: se escribe bajo el
  `clientID` fijo `0` (`BOOTSTRAP_CLIENT_ID`), de modo que todas las réplicas
  generan exactamente el mismo item de Yjs y la creación concurrente no produce
  conflictos. Una migración posterior (otro `clientID`) siempre gana al
  bootstrap en la resolución LWW del mapa.

## Puntos de detección

| Capa | Dónde | Comportamiento |
| --- | --- | --- |
| Servidor, update entrante | `assertValidNoteUpdate` sobre una copia de prueba | `sync-error` `incompatible-schema`, cierre `1003`; no se almacena nada ni se afecta a otros clientes |
| Servidor, historial guardado | carga de la sala | `sync-error` `incompatible-schema` no reintentable, cierre `1011`; no se confunde con un fallo de persistencia |
| Cliente, red | `applyRemote` en `createNoteSync` (`assertCompatibleUpdate`) | estado terminal `onIncompatible`: se corta el socket, no se reintenta, no se aplica nada remoto, el documento local queda intacto |
| Cliente, IndexedDB | `whenSynced` de `persistNote` | si la copia local la escribió un editor más nuevo se rechaza con `NoteSchemaError` **sin leerla ni reescribirla** |

`SyncErrorCode` incorpora `incompatible-schema`, que es **final** para esa
build: reintentar con el mismo código no puede tener éxito.

## Experiencia de usuario

La nota se muestra en solo lectura con el aviso «Esta nota usa un formato más
nuevo que esta versión de SyncPad» y se oculta el indicador de sincronización.

- **Remoto** (el servidor habla un esquema más nuevo): se ofrece «Descargar
  copia (.txt)» del texto local; si había cambios sin confirmar se indica que
  siguen solo en este dispositivo.
- **Local** (la copia del dispositivo es de un editor más nuevo): no se abre ni
  se modifica; no hay exportación porque no es legible con esta versión.

## Recuperación y migración

1. **Actualizar la aplicación** (recargar para obtener el service worker nuevo).
   Con el editor al día la misma copia local y la misma nota vuelven a abrirse
   sin pérdida, porque nada se tocó.
2. **Migración en servidor** (cuando se suba la versión): proceso offline que
   lee el estado de cada nota, lo transforma y escribe un snapshot en el
   esquema nuevo (relacionado con #44/#45). Hasta entonces los clientes viejos
   seguirán rechazando, no degradando, esas notas.
3. La copia local de un cliente viejo nunca se reescribe: es la red de
   seguridad si algo sale mal.

## Verificación

- `shared/src/document.test.ts` (+5): `NoteSchemaError` tipado con `found`,
  versión ausente = incompatible, update rechazado sin tocar el documento,
  item de bootstrap idéntico entre réplicas y la migración gana al bootstrap,
  y un test de **deriva** que comprueba que la constante duplicada del frontend
  coincide con la compartida.
- `backend/tests/ws-schema-compat.test.ts` (3): update de un esquema más nuevo
  rechazado (`incompatible-schema`, `1003`, nada almacenado, otros clientes y la
  sala intactos); historial guardado en v2 ⇒ `incompatible-schema`, `1011`;
  basura sigue siendo `invalid-message`.
- `frontend/tests/note-sync.test.tsx` (+4): respuesta de handshake en esquema
  nuevo rechazada, update en vivo rechazado (la edición local queda pendiente),
  `incompatible-schema` final y `retry()` inerte, y las actualizaciones
  compatibles siguen aplicándose.
- `frontend/tests/note-persistence.test.tsx` (+1): una copia v2 se rechaza y la
  base de datos conserva exactamente la fila original.
- Fixture compartido `shared/src/testing/future-schema.ts` (Yjs en bruto,
  `createFutureNote`).

## Límites

- El frontend duplica la constante de versión (usa su propia copia de Yjs); la
  prueba de deriva evita que diverjan sin que nadie lo note.
- Cada mensaje remoto se valida sobre un documento de prueba: coste O(tamaño del
  documento) por mensaje. Aceptable ahora; se revisará con #48/#50.
- Los clientes ya desplegados antes de este cambio no pueden recibir esta
  protección: solo las builds posteriores detectan el esquema.
- No hay todavía migración automática; la subida de versión (#39) deberá
  entregarla junto con el nuevo esquema.
