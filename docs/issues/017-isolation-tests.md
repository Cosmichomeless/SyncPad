# Issue #17 — Aislamiento de memberships y notas

## Alcance

Se añade una restricción única para impedir invitaciones pendientes duplicadas en
un mismo workspace y email. Las suites existentes y nuevas cubren usuario no
miembro, sesión revocada, invitador que no es OWNER y protección del último OWNER.

Las consultas de notas ya incluyen membership en creación, listado, renombrado y
borrado; las rutas HTTP responden sin revelar contenido de workspaces ajenos.

## Verificación

```sh
./scripts/check.sh
```

La prueba real de PostgreSQL para las migraciones requiere Docker Desktop activo;
la validación de invariantes y autorización se ejecuta sin depender de servicios
externos.