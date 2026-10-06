# #65 · HTTPS, WSS y secretos de producción

## Objetivo

Preparar origen, cookies y credenciales del despliegue para que la app vaya por HTTPS, el
WebSocket por WSS y ningún secreto esté en Git ni en una imagen.

## Qué se hace

- **Un solo origen** (decisión de #64): la web, la API y `/ws` se sirven desde la misma URL.
  Se descarta `SameSite=None` y las cookies de terceros.
- **`frontend/src/lib/endpoints.ts`**: `NEXT_PUBLIC_API_URL` vacío significa peticiones
  relativas y `NEXT_PUBLIC_WS_URL` vacío significa «mismo `host`, `wss:` si la página es
  `https:`». Sin definir, o con una URL, el comportamiento anterior no cambia (Compose y
  desarrollo siguen igual). Prueba: `frontend/tests/endpoints.test.tsx` (4 casos).
- **`scripts/check-secrets.sh`**: comprobación de ficheros versionados y, opcionalmente, de
  imágenes. Se ejecuta en `scripts/check.sh` y en los jobs `checks` e `image` de
  `backend.yml`.
- **`docs/deployment.md`**: tabla de variables de producción, qué es secreto y dónde vive.

## Cómo se verifica

```sh
npm --prefix frontend test                     # endpoints.test.tsx
sh scripts/check-secrets.sh                    # ficheros versionados
docker build -f backend/Dockerfile -t syncpad-backend .
sh scripts/check-secrets.sh syncpad-backend    # y la imagen
```

Comprobado en local con casos negativos: un fichero `.env.production` y una URL de Neon con
contraseña versionados se rechazan; una imagen con `ENV METRICS_TOKEN=…` y un `/app/.env` se
rechaza.

## Límites

- HTTPS/WSS reales solo existen una vez desplegado (#67); aquí se verifica la lógica del
  cliente y la configuración. La comprobación `Secure` de la cookie sobre la URL pública es
  parte del humo de #68.
- `check-secrets.sh` busca patrones conocidos; no sustituye a un escáner como gitleaks ni
  revisa el historial de Git anterior.
