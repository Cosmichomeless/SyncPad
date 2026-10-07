# #64 · Hosting y límites de un solo nodo

## Objetivo

Elegir servicios para web, servidor WebSocket y PostgreSQL sin prometer un escalado que
no existe, con coste de 0 € (es un proyecto de exposición en GitHub).

## Decisión

Render (Docker, un único *web service* gratuito) + Neon (PostgreSQL gratuito). El
razonamiento, las alternativas descartadas, la topología, las cuotas y los límites están
en [`docs/deployment.md`](../deployment.md). La clave: un solo origen para que la cookie
de sesión sea de primera parte.

## Qué se hace

- `docs/deployment.md`: topología, costes y cuotas (verificadas contra la documentación de
  Render y Neon el 2026-10-07), límites de un nodo y plan de copias y restauración.
- `backend/src/database.ts`: el pool registra los `error` de conexiones inactivas. Neon
  cierra las conexiones al suspender el cómputo y, sin listener, ese evento habría
  terminado el proceso. Prueba: `backend/tests/database.test.ts`.

## Cómo se verifica

```sh
npm --prefix backend test      # incluye database.test.ts
```

## Límites

- Las cifras de los planes gratuitos cambian; el documento lleva la fecha de consulta.
- La memoria de la instancia gratuita no está verificada; se mide en #67.
- Los scripts de copia y restauración llegan en #66, no en esta issue.
