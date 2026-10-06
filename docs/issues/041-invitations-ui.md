# #41 · Invitaciones y gestión de miembros en la interfaz

## Objetivo

Que un propietario pueda invitar por email, ver quién está dentro, revocar
invitaciones pendientes y quitar miembros desde la propia aplicación, sin que un
miembro corriente vea ni pueda usar esos controles.

## Modelo

- Roles de workspace: `OWNER` y `MEMBER` (`WorkspaceRole` en `@syncpad/shared`).
- Una invitación es de **un solo uso**, caduca a los **7 días** y va dirigida a un
  email concreto: solo la puede aceptar la cuenta con ese email.
- El token son 32 bytes aleatorios en base64url. El servidor guarda únicamente su
  `sha256`; el token solo se ve **una vez**, al crearlo, y ningún listado lo
  devuelve.
- Índice único `invitations_pending_email_idx (workspace_id, lower(invited_email))
  WHERE accepted_at IS NULL`: no puede haber dos invitaciones vigentes al mismo
  email. Una caducada se reutiliza al reinvitar; una vigente exige revocarla.
- La aceptación es atómica (una sola sentencia con CTE) y `removeMember` nunca
  deja un workspace sin propietario.

## API

| Método y ruta | Quién | Resultado |
| --- | --- | --- |
| `GET /workspaces/:id/members` | cualquier miembro | lista de `WorkspaceMember` |
| `GET /workspaces/:id/invitations` | propietario (403 si no) | `PendingInvitation[]` sin token |
| `POST /workspaces/:id/invitations` | propietario, CSRF | crea y devuelve el token una vez; `409` con `ALREADY_MEMBER` o `INVITATION_PENDING` |
| `DELETE /workspaces/:id/invitations/:invId` | propietario, CSRF | `204`, el enlace deja de valer |
| `DELETE /workspaces/:id/members/:userId` | propietario, CSRF | `204` |

Los identificadores se validan como UUID antes de llegar a SQL y los errores de
conflicto llevan `{ error: { code, message } }` para que la interfaz los explique.

## Interfaz

- **Panel «Miembros del workspace»**: lista con rol (Propietario/Miembro), el
  propio usuario marcado «(tú)», invitaciones pendientes (marcando las
  caducadas), formulario «Invitar por email» y, tras crear el enlace, una caja
  «Enlace de invitación» con «Copiar enlace».
- Un miembro ve la lista pero no los controles, con el texto «Solo un propietario
  puede invitar o quitar miembros.». Quitar a alguien pide confirmación.
- **Enlace**: `/#invite=TOKEN`. El token va en el *fragmento*, que el navegador no
  envía al servidor ni en `Referer`. Al abrirlo se guarda en `sessionStorage` de
  esa pestaña (para sobrevivir a registrarse o iniciar sesión) y se borra de la
  barra de direcciones con `history.replaceState`. También se lee si el enlace se
  pega en una pestaña ya abierta (`hashchange`).
- **Aceptar** es una acción explícita («Aceptar invitación» / «Descartar»), nunca
  automática: abrir un enlace no cambia la pertenencia por sí solo.

## Verificación

- `backend/tests/memberships.test.ts` y `backend/tests/workspace-http.test.ts`:
  listados, revocación, CSRF, `409`, SQL acotado al propietario, ya-miembro, y que
  ninguna respuesta incluye `token` ni `token_hash`.
- `frontend/tests/members.test.tsx` (6): vista de propietario y de miembro, mensajes
  de error, enlace y lectura del fragmento.
- `e2e/tests/invitations.spec.ts` (2), con tres cuentas reales: invitar a quien ya
  es miembro y a un email con invitación vigente; otra cuenta no puede usar un
  enlace ajeno; el invitado acepta y no ve controles (y la API le responde `403`);
  el enlace no vale una segunda vez; el propietario quita al miembro, que pierde
  el acceso; una invitación revocada deja de valer.
- Las sentencias SQL se comprobaron además contra PostgreSQL real.

## Límites

- Quitar a un miembro revoca su acceso a las llamadas HTTP y a nuevas conexiones.
  Los sockets WebSocket ya abiertos se cortan al instante y los permisos se
  recomprueban en cada conexión viva (ver [#51](051-ws-permissions.md)).
- No se envían emails: el propietario comparte el enlace por el canal que quiera.
- No hay todavía transferencia de propiedad ni cambio de rol.
