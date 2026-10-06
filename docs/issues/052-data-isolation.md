# #52 · Auditoría de aislamiento de datos entre cachés y salas

## Objetivo

Comprobar que la sesión, IndexedDB, el service worker y las salas del servidor no
mezclan datos de usuarios distintos, y dejar por escrito la política de qué pasa
con los datos locales al cerrar sesión.

## Política (decisión)

| Dato | Dónde | Al cerrar sesión | Cómo se aísla |
| --- | --- | --- | --- |
| Interfaz privada (listas, nota abierta, editor) | memoria de React | **se borra** al instante (`clearPrivateUI`) | — |
| Identidad offline (`id`, `email`, generación) | `localStorage` | se reemplaza por un registro **bloqueado** sin usuario | la generación invalida toda petición o escritura en vuelo de la sesión anterior |
| Metadatos de navegación (workspaces, notas, visitadas, huérfanas) | IndexedDB `syncpad.offline-metadata.v1` | **se conservan** | claves que empiezan por el `userId`; nadie lee otras claves |
| Texto de cada nota | IndexedDB, una base por nota | **se conserva** | el nombre de la base codifica `[userId, noteId]` |
| Shell de la aplicación | Cache Storage del service worker | no aplica | solo recursos estáticos públicos; las rutas privadas, de auth, `?_rsc` y cualquier otro origen nunca se cachean |

**Por qué se conservan** los datos locales: el modo offline es una promesa del
producto (#25/#26) y las ediciones sin sincronizar no deben perderse por salir de
la sesión. Los datos de Alice no se pierden ni se muestran a Bob; vuelven cuando
Alice entra de nuevo.

**Advertencia para equipos compartidos:** conservar la copia significa que queda
en el disco del navegador hasta que se borren los datos del sitio. Quien necesite
borrado duro al salir debe usar un perfil de navegador propio o «Borrar datos del
sitio». Un borrado completo opcional al cerrar sesión queda como mejora (requiere
decidir qué hacer con las ediciones sin sincronizar).

## Servidor

- Una sala existe por `noteId`, pero **entrar en ella exige** sesión válida,
  membresía (`canAccess`) y origen permitido en cada conexión nueva; la sala viva
  o su caché de historial no abren ninguna puerta.
- Cerrar sesión o quitar a un miembro corta sus sockets (#51).
- Las salas no comparten estado: cada una tiene su documento, su difusión y su
  lista de presencia.

## Verificación

- `backend/tests/ws-isolation.test.ts` (3):
  - otro usuario recibe **403** y un anónimo **401** al abrir una nota cuya sala
    está viva y con historial en caché;
  - tras cerrar sesión el socket vivo se corta (4403) y el token antiguo ya no abre
    la nota aunque su historial siga almacenado (401);
  - dos notas en el mismo proceso no comparten contenido, historial persistido ni
    presencia, y una reconexión a la nota de Bob parte de su historial.
- `e2e/tests/account-isolation.spec.ts` (1, Playwright): Alice escribe, sale; la
  interfaz no conserva rastro; Bob entra en el **mismo navegador** y no ve ni su
  workspace ni su texto, ni conectado ni **sin red tras recargar**; el registro de
  identidad de `localStorage` solo contiene a Bob; al volver Alice recupera su
  texto y no ve nada de Bob.
- Ya existentes que cubren el resto de la auditoría:
  `frontend/tests/note-persistence.test.tsx` (mismo `noteId` de dos usuarios en
  bases distintas, claves sin ambigüedad), `offline-metadata.test.tsx` (usuarios
  aislados, escrituras de generaciones obsoletas rechazadas),
  `offline-session.test.tsx` (el registro persistido solo contiene id/email/
  generación; errores de almacenamiento cierran en falso) y
  `service-worker.test.tsx` (solo se sirven recursos estáticos).

## Hallazgos

Sin fugas entre cuentas ni entre salas. Dos observaciones, ninguna es un fallo:

1. Los datos locales persisten tras salir (política arriba): es aislamiento, no
   borrado.
2. El texto de las notas en IndexedDB no está cifrado; protegerlo frente a alguien
   con acceso al disco del dispositivo queda fuera del alcance.
