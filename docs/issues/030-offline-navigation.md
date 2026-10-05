# #30 — Identidad local y navegación offline por usuario

## Alcance implementado

- `api-request.ts` separa rechazos de transporte (`NetworkError`) de errores
  HTTP (`HttpError` con status). Un 401/403/404/500 conserva su clasificación
  aunque el cuerpo no sea JSON. El rechazo de CSRF impide enviar la mutación.
  Las peticiones usan cookies del navegador y `cache: no-store`; no se
  almacenan respuestas HTTP privadas, contraseñas ni tokens.
- `offline-session.ts` guarda exclusivamente ID/email y una generación en
  localStorage. Logout reemplaza la identidad por un registro bloqueado;
  `/auth/me` no lo desbloquea. Solo login/registro explícito puede hacerlo.
  Los snapshots de generación protegen respuestas de autenticación tardías;
  los eventos storage invalidan la UI de otras pestañas.
- `offline-metadata.ts` usa IndexedDB nativo con stores workspaces, notes y
  visited; las claves de listas/visitas son tuplas de usuario/workspace/nota.
  `null` indica caché ausente, `[]` un listado vacío conocido. Las transacciones
  esperan complete/error/abort, revalidan la generación antes del commit y
  rechazan escrituras obsoletas. Los listados autorizados purgan metadata y
  visitas de recursos eliminados; una hidratación tardía no vuelve a marcar
  una nota que ya no está autorizada en el listado.
- La portada valida primero la sesión por red. Solo `NetworkError` permite
  recuperar identidad/listados locales; offline muestra únicamente notas
  visitadas. La marca de visita se confirma tras hidratar Yjs, antes de
  publicar contenido/conectar el socket. La selección de notas recién creadas
  también espera el listado persistido.
- Logout limpia inmediatamente usuario, listados, selección y contenido, cierra
  el socket y después intenta revocación remota. Si no hay red, explica en
  español que la sesión local está cerrada pero la remota no pudo revocarse.
- El evento online revalida identidad y refresca resúmenes conservando IDs
  seleccionados. No sustituye el documento Yjs: su efecto depende de ID de
  usuario y nota, no de la identidad del objeto resumen. Un 401 bloquea toda
  la UI privada; 403/404 de recurso elimina la selección y su metadata.
  Fallos al persistir/purgar metadata bloquean conservadoramente el acceso
  local, evitando reutilizar una lista antigua que podría contener revocados.

## Verificación automática — 2026-10-05

Entorno: Node.js 22.16.0, npm 10.9.2. Sin dependencias nuevas ni hooks de
producción destinados a tests. Se usan node:test y fake-indexeddb reales.

| Comando | Resultado observado |
| --- | --- |
| `npm --prefix frontend test` antes de implementar helpers | RED: 29 existentes pasan; 3 suites nuevas fallan por helpers ausentes |
| Tests focalizados de generación y almacenamiento | RED de assertions para storage fail-closed, hidratación tardía, invalidación antes de commit, eliminación de workspace y notificación duplicada; GREEN después de sus cambios |
| `npm --prefix frontend test` final | 52/52 pasan, 0 fallos/cancelados/omitidos |
| `npm --prefix frontend run lint` | Exit 0, sin warnings |
| `npm --prefix frontend run typecheck` | Exit 0 |
| `npm --prefix frontend run build` | Exit 0; root estática; postbuild genera shell anónimo y 12 assets |
| `npm --prefix frontend run typecheck` después del build | Exit 0 |
| `npm --prefix backend test` | 54/54 pasan, 0 omitidos |
| `npm --prefix backend run lint` | Exit 0 |
| `npm --prefix backend run typecheck` | Exit 0 |
| `npm --prefix backend run build` | Exit 0 |

Los tests cubren clasificación HTTP/JSON/CSRF, cookies/no-store, identidad sin
credenciales, generación de la misma cuenta y de cuentas distintas, eventos
storage con suscriptores concurrentes, bloqueo durable leído en un proceso
nuevo, aislamiento de metadata, vacío versus miss, visitas, purgas, apertura
fallida y aborts reales de IndexedDB incluso después de request success.

## Aceptación pendiente del controlador

No se ejercitó esta UI en navegador durante esta implementación. No se usó
ni controló la sesión `syncpad-verification` ni los servidores de prueba del
controlador. Las pruebas automáticas no sustituyen los siguientes escenarios
de producción, que siguen pendientes:

- Recarga completa offline y reapertura de una nota visitada con su título
  y contenido local, incluyendo navegación entre workspaces.
- Cambio A/B y comprobación de aislamiento de metadata y contenido.
- Logout offline y en dos pestañas; recarga con cookie aún presente, sin
  restaurar el acceso hasta login explícito.
- Denegaciones 401/403/404 y ausencia de resurrección offline posterior.
- Reconexión con metadata cambiada, mismos IDs seleccionados y contenido
  Yjs intacto, sin recrear el documento.

También están pendientes las revisiones independientes de especificación y
calidad. No se publican PRs ni se cierran #25/#26/#30 en esta entrega.

## Límites

La identidad offline es una comodidad del perfil local, no autorización del
servidor ni cifrado/borrado seguro. El bloqueo durable y la comunicación entre
pestañas requieren almacenamiento del navegador operativo. Se conservan los
updates Yjs por usuario/nota al cerrar sesión para no perder ediciones; el
perfil del navegador sigue conteniendo datos privados. No se añade edición
desconectada (#27), reconexión/sincronización de WebSocket (#28) ni UI nueva
de estados (#29). Las modificaciones originales de backend tests, next-env.d.ts
y globals.css, y los planes futuros 027/028/029, quedan fuera del commit.
