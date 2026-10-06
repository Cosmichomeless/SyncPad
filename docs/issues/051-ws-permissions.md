# #51 · Recomprobar permisos en las conexiones WebSocket

## Objetivo

Que perder el acceso a una nota corte la conexión viva: quien ya no es miembro ni
recibe ni puede publicar cambios, aunque conserve el ID de la nota y un socket
abierto. Hasta ahora los permisos solo se comprobaban al abrir el socket.

## Qué se comprueba y cuándo

Cada conexión tiene una *guarda* con su usuario, su token de sesión y su nota.
«Sigue permitida» significa dos cosas a la vez: **la sesión sigue existiendo y es
del mismo usuario**, y **ese usuario sigue siendo miembro del espacio de la nota**.

| Disparador | Cuándo | Latencia de corte |
| --- | --- | --- |
| Quitar un miembro (`DELETE /workspaces/:id/members/:userId`) | al terminar la llamada, se recomprueban las conexiones de ese usuario | inmediata |
| Cerrar sesión (`POST /auth/logout`) | se recomprueban las conexiones con ese token | inmediata |
| Mensaje entrante | antes de procesarlo, si la última comprobación es más antigua que `SYNC_PERMISSION_RECHECK_MS` | como mucho una ronda de mensaje |
| Barrido periódico | cada `SYNC_PERMISSION_RECHECK_MS` sobre las conexiones sin comprobar, **aunque estén en silencio** | como mucho ese intervalo |

Los dos primeros cubren los cambios hechos a través de la propia API (el caso
normal); los otros dos son la red de seguridad si el permiso cambia por otra vía
(otro proceso, SQL directo, sesión caducada).

## Qué ocurre al revocar

1. El socket **sale de la sala de forma síncrona**: a partir de ese instante no
   recibe difusiones ni presencia, y los demás dejan de verlo conectado.
2. Se descartan los mensajes suyos que ya estaban en cola: un update encolado
   antes de perder el acceso **no se guarda ni se difunde**.
3. Recibe `sync-error` con `code: 'access-revoked'` (`retryable: false`) y se
   cierra con el código **4403**.
4. El cliente muestra «Ya no tienes acceso a esta nota. Tus cambios siguen
   guardados en este dispositivo.», deja de reintentar y conserva el texto local.
   Un reintento manual vuelve a pasar por la comprobación de acceso al abrir el
   socket (403 si sigue sin acceso).

Si **no se puede comprobar** (la base de datos falla), no se da por bueno: el
mensaje no se aplica, se responde `persistence-unavailable` (reintentable) y se
cierra con 1011. Un fallo transitorio no se confunde con una revocación.

## Configuración y observabilidad

- `SYNC_PERMISSION_RECHECK_MS` (defecto `5000`, mínimo `1`): cuánto se confía en
  la última comprobación. Menos es más estricto y más consultas; con la carga del
  #50 (~1000 updates/s) la comprobación es una consulta por conexión cada 5 s, no
  una por mensaje.
- Métrica `syncpad_access_revoked_total{reason}` con `reason` ∈ `recheck`,
  `member-removed`, `logout`, y log `ws access revoked` (sala, conexión, usuario,
  motivo; nunca contenido).

## Verificación

- `backend/tests/ws-permissions.test.ts` (6): un miembro quitado por la API se
  corta de inmediato (con el intervalo largo, así que es el gancho HTTP) y deja de
  recibir, sin afectar a otros miembros; un usuario sin acceso **no puede publicar**
  (update sin almacenar, sin ack, sin difusión); una conexión en silencio se corta
  por el barrido; el cierre de sesión corta sus sockets; si la comprobación falla
  se rechaza (1011, reintentable); y un miembro que conserva el acceso no se ve
  afectado.
- `backend/tests/limits.test.ts`: la variable se lee y valida.
- `frontend/tests/note-sync.test.tsx` (+1): `access-revoked` detiene la
  sincronización, informa y conserva el texto local sin reintentar.

## Límites

- Con el intervalo por defecto, un cambio de permisos hecho **fuera de esta API**
  tarda hasta 5 s en cortar la conexión; los hechos por la API son inmediatos.
- El gancho vive en el proceso que atiende la llamada. Con varias instancias
  haría falta un canal entre ellas; hasta entonces actúa el barrido.
- Cambiar un rol (p. ej. de propietario a miembro) no corta nada porque ambos
  roles escriben; si se añade un rol de solo lectura habrá que distinguirlo aquí.
