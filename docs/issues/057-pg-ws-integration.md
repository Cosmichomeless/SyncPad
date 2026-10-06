# #57 · Pruebas de integración con PostgreSQL y WebSocket

## Objetivo

Ejecutar el servidor completo (API HTTP, salas WebSocket y servicios reales)
contra un PostgreSQL real, partiendo siempre de una base de datos limpia, para
comprobar lo que los tests con almacén en memoria no pueden: el esquema, las
migraciones, los permisos revalidados contra la base de datos y la
reconstrucción de una nota tras un reinicio.

## Cómo se ejecutan

```bash
docker compose up -d --wait postgres   # o cualquier PostgreSQL 16 accesible
npm --prefix backend run test:integration
```

Por defecto usan `postgres://syncpad:syncpad@127.0.0.1:55432/syncpad`, el mismo
valor que `e2e`. `DATABASE_URL` lo sustituye. Esa conexión solo sirve para crear
y borrar bases de datos de usar y tirar; **nunca se escribe en ella**.

Si PostgreSQL no está accesible el test falla con un mensaje que dice qué
arrancar, en vez de saltarse en silencio y dar una falsa sensación de cobertura.

Las integraciones **no forman parte de `scripts/check.sh`**: exigirían un
PostgreSQL levantado en cada comprobación local. Se lanzan a mano con el comando
anterior (el CI de #58-#62 puede añadir el servicio de base de datos y llamarlo).

## Base de datos limpia

`backend/integration/harness.ts` hace, por cada test:

1. `CREATE DATABASE syncpad_it_<pid>_<hex>`.
2. Ejecuta la **CLI real** de migraciones (`tsx src/migrate.ts`) como subproceso.
   No se importa: `migrate.ts` actúa al importarse, y así se prueba también el
   punto de entrada que usa Compose.
3. Levanta `createSyncServer` con `createAuthService`, `createWorkspaceService`,
   `createNoteService` y `createPostgresSyncStore` sobre un pool real, en un
   puerto efímero y con `loadSecurityConfig`.
4. Al terminar, cierra los clientes, el servidor y el pool, y borra la base con
   `DROP DATABASE ... WITH (FORCE)`. Los cierres van en orden inverso al de
   creación para que ningún pool se quede sin su base.

Levantar un segundo servidor sobre la misma base simula un reinicio: no
sobrevive ninguna sala, sesión ni caché en memoria.

Los tests no importan `yjs`: usan los helpers de `@syncpad/shared`.

## Qué se verifica

`migrations.int.test.ts`

- Una base vacía se migra desde cero, con todas las migraciones registradas y
  las ocho tablas de `syncpad`.
- Volver a migrar no destruye datos ni tablas.
- El esquema impone lo que la aplicación da por hecho: correo único sin
  distinguir mayúsculas, solo los roles `OWNER` y `MEMBER`, título no vacío,
  updates no duplicados y borrado en cascada de updates y snapshots.

`ws-access.int.test.ts`

- **Conexión autorizada**: un miembro recibe la nota, guarda un cambio, recibe
  su `ack` y la fila queda en `note_updates`.
- **Conexiones denegadas** (rechazo en el `upgrade`, sin llegar a crear sala):
  sin cookie `401`, sesión desconocida `401`, `noteId` mal formado `401`, no
  miembro `403`, nota inexistente `403`, origen ajeno `403`. No se persiste nada.
- Aceptar una invitación abre la nota; quitar al miembro cierra su conexión con
  `4403` / `access-revoked`, no molesta al propietario y no puede volver.
- Una membresía borrada directamente en la base la detecta la revalidación
  periódica (`4403`) y lo que el expulsado todavía tenga en vuelo no se guarda
  ni llega a nadie.
- Cerrar sesión cierra la conexión viva y una sesión caducada en base se
  rechaza con `401`.
- Borrar una nota avisa a sus colaboradores (`4404` / `note-deleted`, no
  reintentable), borra su historial en cascada y cierra la puerta.

`ws-persistence.int.test.ts` (reconstrucción de la nota)

- Dos clientes con ediciones concurrentes convergen y cada update aceptado se
  guarda una sola vez; reenviar uno ya guardado se confirma pero no se duplica.
- Tras reiniciar el servidor (cierre `1001` a los clientes), la nota se
  reconstruye desde PostgreSQL con la misma cookie de sesión, y una edición
  nueva también sobrevive.
- Con `snapshotEvery: 3` y `retentionMs: 0` se escribe un snapshot, la
  compactación borra los updates cubiertos y la nota se reconstruye solo con
  snapshot más los updates posteriores.
- Un snapshot es un dato derivado: si se borra y los updates siguen en su
  ventana de retención, la nota se reconstruye igual.
- Dos notas de la misma base no comparten historial.

## Decisiones

- **Una base por test, no por ejecución.** Cuesta unos 250 ms cada una y
  garantiza que ningún test hereda filas de otro, con independencia del orden.
- **Los tests de integración se ejecutan en serie** (`--test-concurrency=1`)
  porque comparten la instancia de PostgreSQL y simplifica los diagnósticos.
- **Sin servicio propio en Compose.** Reutilizan el contenedor de desarrollo, ya
  que solo crean bases con nombre único y las borran.

## Defecto detectado en las migraciones (no corregido aquí)

`migrate.ts` crea `schema_migrations` sin cualificar. Con el rol `syncpad`, el
`search_path` por defecto (`"$user", public`) resuelve `"$user"` al esquema
`syncpad` en cuanto existe. La primera ejecución crea la tabla en `public`; la
segunda, como el esquema `syncpad` ya existe, crea **otra** `syncpad.schema_migrations`
vacía, vuelve a aplicar las ocho migraciones y las apunta ahí (el mensaje es otra
vez `Applied 8 migration(s)`). Las terceras ejecuciones ya dicen `Applied 0`.
No rompe nada hoy porque todas las migraciones son idempotentes, pero cualquier
migración futura no idempotente fallaría en la segunda ejecución. Por eso el test
de «migrar otra vez» comprueba que los datos y las tablas sobreviven y **no**
afirma `Applied 0`. Convendría abrir un issue para cualificar la tabla
(`public.schema_migrations`).

## Límites

- Hace falta un PostgreSQL accesible y con permiso para `CREATE DATABASE`.
- No cubren varios procesos de backend a la vez ni el reparto entre réplicas.
- La compactación se comprueba con `retentionMs: 0`; el valor por defecto de
  producción no se espera en tiempo real.
- Los tiempos de espera de la revalidación (20 ms) están ajustados para el test.
