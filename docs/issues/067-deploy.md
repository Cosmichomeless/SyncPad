# #67 · Configuración de despliegue y prueba con dos usuarios

## Objetivo

Dejar en el repositorio todo lo necesario para publicar SyncPad en el hosting gratuito
elegido en #64, y comprobar el flujo de dos usuarios a través del mismo proxy que habrá en
producción.

## Qué se hace

- **`deploy/Dockerfile`**: imagen única (~99 MB) con backend, Next.js `standalone` y Caddy.
  Next se compila con `NEXT_PUBLIC_API_URL` y `NEXT_PUBLIC_WS_URL` vacíos (mismo origen).
- **`deploy/supervisor.mjs`**: entrypoint en Node. Comprueba `DATABASE_URL` y la URL pública,
  aplica las migraciones, arranca los tres procesos, reenvía `SIGTERM` y termina si uno cae.
- **`deploy/Caddyfile`**: enruta API y `/ws` al backend y el resto a Next.js; sin HTTPS
  propio (lo termina Render).
- **`render.yaml`**: blueprint con plan `free`, health check en `/health`, `DATABASE_URL` sin
  valor en el repositorio y `METRICS_TOKEN` generado.
- **Job `deploy-image` en `backend.yml`**: construye la imagen, comprueba que no lleva
  secretos, la arranca contra PostgreSQL, repite la edición entre dos clientes por el puerto
  único y comprueba el apagado limpio. El filtro de rutas del workflow incluye ahora
  `deploy/**` y `frontend/**`.

## Cómo se verifica

```sh
docker build -f deploy/Dockerfile -t syncpad-deploy .
docker run -d --name syncpad-deploy-test -p 127.0.0.1:8080:10000 \
  -e DATABASE_URL=postgres://syncpad:syncpad@host.docker.internal:55432/deploytest \
  -e CORS_ORIGIN=http://127.0.0.1:8080 -e COOKIE_SECURE=false syncpad-deploy
cd backend && SYNCPAD_API_URL=http://127.0.0.1:8080 SYNCPAD_ORIGIN=http://127.0.0.1:8080 \
  SYNCPAD_WEB_URL=http://127.0.0.1:8080 npx tsx ../scripts/smoke-stack.mts
```

Resultado local: contenedor `healthy` en unos 8 s; web y `/health` por el mismo puerto; la
edición de un navegador llega al otro tras el `ack`; un `Origin` ajeno recibe 403 en `/ws`;
`docker stop` cierra el WebSocket con 1001 y el contenedor sale con 0 (`--wait-close`).
Memoria en reposo ~83 MiB. `check-secrets.sh` no encuentra nada en la imagen.

## Límites

- **No hay despliegue real**: crear las cuentas de Render y Neon y pegar `DATABASE_URL` es un
  paso manual ([`deployment.md`](../deployment.md#pasos-manuales-para-desplegar)). HTTPS, WSS,
  `RENDER_EXTERNAL_URL` y el arranque en frío solo se pueden comprobar sobre la URL real.
- La memoria bajo carga y la cuota de RAM del plan gratuito no están medidas.
- El job `deploy-image` es nuevo y aún no se ha ejecutado en GitHub.
- La reconexión sin red del navegador a través de Caddy no se ha recorrido con Playwright; se
  comprobó el cierre 1001 del servidor y la reconexión sigue siendo la del cliente (#49).
