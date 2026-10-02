# Issue #12 — API de workspaces

## Alcance

El backend expone `POST /workspaces`, `GET /workspaces` y
`GET /workspaces/:id`. Todas las rutas requieren una sesión válida; la creación
requiere además CSRF. Listado y detalle consultan memberships, por lo que un
usuario no puede ver workspaces ajenos.

## Verificación

```sh
npm --prefix backend test
npm --prefix backend run lint
npm --prefix backend run typecheck
npm --prefix backend run build
```

La suite cubre creación, listado, detalle e intento de acceso sin autenticación.