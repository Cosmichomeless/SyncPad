# Issue #16 — UI de acceso y navegación

## Alcance

La portada de Next.js ahora ofrece registro/login, selección y creación de
workspaces, listado de notas y apertura de una nota. Las llamadas usan las APIs
de #9, #12 y #15 con credenciales y CSRF. Los estados vacíos, carga implícita,
errores y logout están representados en la interfaz.

El editor colaborativo todavía es un placeholder hasta conectar Yjs en #22.

## Verificación

```sh
npm --prefix frontend test
npm --prefix frontend run lint
npm --prefix frontend run typecheck
npm --prefix frontend run build
```