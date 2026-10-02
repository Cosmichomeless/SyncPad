# Issue #13 — Invitaciones y gestión de miembros

## Alcance

Los OWNER pueden crear invitaciones de un solo uso con token aleatorio almacenado
como hash y expiración de siete días. El usuario invitado acepta con su propia
sesión y solo si el email coincide; la aceptación marca la invitación y crea una
membership `MEMBER` de forma atómica.

`POST /workspaces/:id/invitations` crea invitaciones, `POST
/invitations/:token/accept` las acepta y `DELETE
/workspaces/:id/members/:userId` elimina miembros. Todas las mutaciones requieren
CSRF. Los MEMBER no pueden invitar ni eliminar y nunca se elimina el último OWNER.

## Verificación

```sh
npm --prefix backend test
npm --prefix backend run lint
npm --prefix backend run typecheck
npm --prefix backend run build
```

La suite cubre ownership, tokens hash, invitaciones inválidas y protección del
último OWNER.