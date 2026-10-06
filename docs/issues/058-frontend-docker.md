# #58 · Imagen de producción de la interfaz Next.js

## Objetivo

Empaquetar el frontend en una imagen de producción pequeña, sin secretos ni datos
locales, que arranque con configuración externa.

## Qué se hace

- `frontend/Dockerfile`: build multi-etapa (`deps` → `build` → `runner`) sobre
  `node:22.16-alpine` (argumento `NODE_IMAGE`). **El contexto es la raíz del
  repositorio**, porque `@syncpad/shared` vive fuera de `frontend/`:

  ```sh
  docker build -f frontend/Dockerfile -t syncpad-frontend .
  ```

- `@syncpad/shared` se resuelve igual que en el repositorio: la etapa `deps`
  instala `shared/` (necesita `yjs`) y `frontend/`, cuyo
  `node_modules/@syncpad/shared` es un enlace simbólico a `/app/shared`. Next lo
  compila con `transpilePackages`, así que la imagen final no necesita el código de
  `shared/` en tiempo de ejecución.
- `frontend/next.config.ts`: con `NEXT_OUTPUT=standalone` (solo lo fija el
  Dockerfile) activa `output: 'standalone'` y usa la raíz del repositorio como
  `outputFileTracingRoot`. `next build` normal y el e2e no cambian.
- La etapa `runner` copia solo la salida `standalone`, `.next/static` y `public/`
  (que contiene el service worker y el shell offline generados por `postbuild`).
  Corre como usuario `node` (no root), con `HOSTNAME=0.0.0.0` (Docker fija
  `HOSTNAME` al id del contenedor y Next lo usaría como interfaz de escucha).
- `HEALTHCHECK`: petición HTTP a `/` desde dentro del contenedor.
- `.dockerignore` (raíz): excluye `.env*` (salvo `.env.example`), `.git`, `.claude`,
  `node_modules`, `.next`, `dist`, `e2e`, `docs`, `reports`, `plans` y los
  artefactos generados de `frontend/public`. Además el Dockerfile copia solo
  `src/`, `scripts/` y la configuración, nunca `COPY . .`.

## Configuración externa

| Variable | Cuándo | Por defecto |
| --- | --- | --- |
| `PORT` | arranque (`docker run -e`) | `3000` |
| `HOSTNAME` | arranque | `0.0.0.0` |
| `NEXT_PUBLIC_API_URL` | **build** (`--build-arg`) | `http://127.0.0.1:3001` |
| `NEXT_PUBLIC_WS_URL` | **build** (`--build-arg`) | `ws://127.0.0.1:3001/ws` |

Next incrusta `NEXT_PUBLIC_*` en el bundle del navegador y el service worker cachea
el shell por `BUILD_ID`; reescribirlos al arrancar dejaría cachés obsoletas en los
navegadores. Por eso las URLs públicas del backend son argumentos de construcción:
son URLs públicas, nunca secretos, y la imagen no contiene ningún otro valor de
configuración.

## Cómo se verifica

```sh
docker build -f frontend/Dockerfile -t syncpad-frontend .
docker run -d --name syncpad-fe -p 127.0.0.1:13000:3000 syncpad-frontend
docker ps --filter name=syncpad-fe          # estado (healthy) en unos segundos
curl -s http://127.0.0.1:13000/ | grep auth-shell
curl -s http://127.0.0.1:13000/sw.js | head -c 120
docker exec syncpad-fe id                   # uid=1000(node)

# Configuración externa: otra URL de backend sin tocar el código
docker build -f frontend/Dockerfile -t syncpad-frontend:cfg \
  --build-arg NEXT_PUBLIC_API_URL=https://api.example.test \
  --build-arg NEXT_PUBLIC_WS_URL=wss://api.example.test/ws .
docker run --rm syncpad-frontend:cfg sh -c "grep -rl api.example.test /app/frontend/.next/static"
docker rm -f syncpad-fe
```

Resultado observado: `healthy`, `/` responde 200 con el shell de login, `sw.js` y
los chunks estáticos se sirven, el proceso corre como `node` y el bundle de la
variante `:cfg` contiene `api.example.test` y no `127.0.0.1:3001`.

## Límites

- Las URLs públicas se fijan al construir: cambiar de entorno exige otra imagen
  (o un `--build-arg` distinto). Un reemplazo en caliente queda fuera de alcance
  por la caché del service worker.
- La imagen no incluye el backend ni la base de datos; el conjunto completo se
  levanta con Docker Compose (#60).
- Se probó en `linux/arm64`; la imagen base es multi-arquitectura.
