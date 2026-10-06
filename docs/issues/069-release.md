# #69 · Demo pública, capturas de despliegue y release v1.0.0

## Objetivo

Que el README enlace a una demo en marcha, que haya capturas del despliegue y que exista una
release `v1.0.0` con un caso reproducible de conflicto resuelto.

## Qué está hecho

- README, `docs/architecture.md`, `docs/demo-script.md` y este índice describen el despliegue
  tal como existe: preparado y ensayado en local, sin afirmar una URL pública.
- Cifras de pruebas al día (146 backend, 161 frontend, 18 integración) y el resultado real del
  job `image` de CI (verde en la PR #96) en lugar de «no se pudo ejecutar».
- El caso reproducible de conflicto resuelto ya existe como prueba y como recorrido:
  dos réplicas editan sin conexión y convergen ([guion de demo](../demo-script.md), pruebas
  `ws-persistence` e integración de tres clientes con reinicio).

## Qué falta (requiere acciones fuera del repositorio)

1. Crear las cuentas de Render y Neon y desplegar con `render.yaml`
   ([pasos](../deployment.md#pasos-manuales-para-desplegar)).
2. Ejecutar `scripts/smoke-public.mts` sobre la URL real y corregir lo que falle.
3. Poner la URL en el README (callout y barra de enlaces), cambiar el badge de estado y
   añadir las capturas del despliegue a `docs/screenshots/`.
4. Publicar la release `v1.0.0` con las notas y el caso de conflicto resuelto. Es una acción
   pública: se hace solo con confirmación expresa.

## Límites

Mientras 1–4 no se hagan, #69 queda abierta: la documentación es honesta con ese estado, pero
no hay demo ni release.
