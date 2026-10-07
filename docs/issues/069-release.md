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

## Despliegue real (2026-10-07)

Desplegado en https://syncpad-0xyk.onrender.com (Render + Neon, plan gratuito). El primer intento falló por la capability de
fichero de Caddy (`spawn EPERM`, arreglado en #101 y vigilado ahora en CI). Con el segundo,
`scripts/smoke-public.mts` pasó 10 de 10. README, badge, guion de demo y arquitectura
enlazan la URL.

## Qué falta

1. Capturas del despliegue en `docs/screenshots/` (hoy son las generadas con datos sembrados).
2. Medir el arranque en frío y anotarlo en `docs/deployment.md`.
3. Publicar la release `v1.0.0` con las notas y el caso de conflicto resuelto. Es una acción
   pública: se hace solo con confirmación expresa.

## Límites

Es un despliegue de exposición en plan gratuito: se duerme sin tráfico, tiene 0,5 GB de base de
datos y sus datos no son privados. #69 sigue abierta hasta publicar la release.
