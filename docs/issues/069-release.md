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

1. Medir el arranque en frío y anotarlo en `docs/deployment.md`.
2. Publicar la release `v1.0.0` con `docs/releases/v1.0.0.md`. Es una acción pública: se hace solo con confirmación expresa.

Las capturas del README se quedan como están (datos sembrados en local, con las mismas personas y notas en todas); no se suben capturas de la instancia pública para no llenar su base de datos de ejemplo.

## Caso de conflicto

`scripts/conflict-demo.mts`: dos réplicas sin conexión reemplazan la misma palabra y convergen conservando las dos versiones. No necesita servidor. Está en las notas de la release.

## Límites

Es un despliegue de exposición en plan gratuito: se duerme sin tráfico, tiene 0,5 GB de base de
datos y sus datos no son privados. #69 sigue abierta hasta publicar la release.
