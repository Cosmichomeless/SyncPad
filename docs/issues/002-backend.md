# Issue #2 — Base HTTP/WebSocket en TypeScript

## Alcance

Servidor independiente en backend/, con GET /health y upgrade WebSocket en /ws.
HTTP y WebSocket comparten un proceso; Next.js se ejecuta por separado. Factory
sin efectos globales para pruebas, entrada ejecutable y configuración HOST/PORT
validada. Loopback por defecto. Scripts dev/build/start/lint/typecheck/test.

Las conexiones no procesan mensajes de aplicación y todavía no tienen autenticación,
salas ni Yjs. Esta entrega es solo para desarrollo local, no para producción.
Hay un límite básico de 64 KiB por mensaje y compresión desactivada; los límites
completos y configurables se desarrollan en #48. Cierre idempotente con código
1001 y plazo de un segundo antes de terminar sockets pendientes.

## Verificación reproducible

Desde backend/, con Node 22.16.0 y npm 10.9.2:

```sh
npm ci --cache .npm --no-audit --no-fund
npm test
npm run lint
npm run typecheck
npm run build
SYNCPAD_TEST_BUILT=1 node --import tsx --test tests/entrypoint.test.ts
```

- RED inicial: 12 fallos de 15 pruebas ante ausencia de health, upgrade y validación.
- GREEN: 17/17 pruebas; lint, typecheck y build exit 0.
- Proceso compilado: 2/2 pruebas, incluyendo HTTP real, WebSocket real y SIGTERM.
- Configuración inválida termina con exit 1 sin imprimir el valor introducido.
- Rutas desconocidas HTTP y upgrade rechazadas con 404.
- Prueba del frontend repetida tras integrar #1: 1/1.

Los tests usan puertos efímeros y cierran sus propios procesos; no requieren Docker
ni PostgreSQL. npm mantiene una advertencia de deprecación de ESLint 9, compatible
con el frontend actual. La instalación se efectuó con caché local ignorado.

## Revisión e integración

Revisión directa de alcance, cierre de conexiones, configuración, lockfile y pruebas
con el modelo actual, siguiendo la preferencia del usuario de evitar más subagentes.
Base main tras PR #70. Se publica una PR exclusiva para #2, se integra tras verificar
y se enlaza su resultado en la issue. Sin CI remoto todavía (#61 y #62).
