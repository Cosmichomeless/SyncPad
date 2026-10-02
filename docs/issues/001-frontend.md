# Issue #1 — Base del frontend

## Entrega

- Rama: issue/1-nextjs-foundation, creada desde main (a8c8ef8).
- Next.js App Router en frontend/, React, TypeScript estricto y presets ESLint
  de Next (core-web-vitals y typescript).
- Portada en español con main, h1 SyncPad y objetivo explícitamente futuro.
- Layout con lang=es, título y descripción; CSS con fuentes locales del sistema.
- Sin editor, autenticación, backend, sincronización, IndexedDB ni CRDTs.
- Plan original del controlador incluido sin modificar. Sus pasos de publicación
  no se ejecutaron: el controlador publica. No se hizo push, PR, merge ni cierre.

## Dependencias

Entorno comprobado: Node v22.16.0 y npm 10.9.2.
Se consultó el registro con npm view para version, engines y peerDependencies
de next, react, react-dom, typescript, eslint, eslint-config-next, @types/node,
@types/react, @types/react-dom y tsx, además de los peers de eslint-plugin-react
y typescript-eslint.

Versiones directas exactas: Next y eslint-config-next 16.3.8; React y React DOM
19.3.0; TypeScript 6.0.3; ESLint 9.39.5; tsx 4.23.15; tipos Node 22.20.5 y tipos
React/React DOM 19.3.0. package-lock.json fija las dependencias transitivas.
Next requiere Node >=20.9.0. ESLint 10 no satisface los peers del plugin React;
TypeScript 7 no satisface el rango <6.1.0 de typescript-eslint. Se escogieron
las versiones compatibles consultadas, sin forzar peers. npm advirtió que
ESLint 9.39.5 ya no tiene soporte; es una limitación del conjunto compatible.

## Pruebas y resultados reales

Comandos ejecutados desde la raíz salvo donde se indica:

| Comando | Resultado |
| --- | --- |
| node --version / npm --version | v22.16.0 / 10.9.2 |
| npm --prefix frontend run typecheck (antes del scaffold) | Falla esperada: ENOENT package.json |
| npm --prefix frontend test (RED) | Exit 1, ERR_ASSERTION: main no encontrado en HTML vacío |
| npm --prefix frontend test (GREEN y repetición final) | Exit 0, 1 test, 1 pass, 0 fail |
| npm --prefix frontend run lint | Exit 0, sin errores ni warnings |
| npm --prefix frontend run typecheck | Exit 0, antes y después del build y del smoke |
| NEXT_TELEMETRY_DISABLED=1 npm --prefix frontend run build | Exit 0, Next 16.3.8 Turbopack; / y /_not-found estáticos |
| npm --prefix frontend ci --cache frontend/.npm --no-audit --no-fund | Exit 0, 350 paquetes instalados |
| git diff --check | Exit 0 |

El test usa node:test y renderToStaticMarkup sobre el componente real, no lee
archivos fuente ni usa mocks. Primero se creó un scaffold que devolvía null;
la falta de main produjo RED antes de implementar la portada. Una ejecución
anterior tuvo un error de sintaxis del test, corregido antes de contar RED.

También se comprobó typecheck sin .next: se movió temporalmente ese directorio
propio a frontend/.npm/issue-001-next-backup, se ejecutó el mismo comando y se
restauró en finally. Exit 0. next-env.d.ts se entrega con referencias de tipos
estables: Next regenera sus imports de tipos de rutas durante dev/build.

## Smoke de desarrollo

Se reservó un puerto libre con node:net y se lanzó, con cwd frontend y
NEXT_TELEMETRY_DISABLED=1:

```sh
node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 62873
```

Es el mismo ejecutable de dev=next dev. Se comprobó con fetch y node:assert:

- GET /: HTTP 200; title SyncPad; html lang=es; main; h1 SyncPad: PASS.
- GET /ruta-inexistente: HTTP 404: PASS.
- El proceso se lanzó en su propio grupo (PID 71612); finally envió SIGTERM
  únicamente a ese grupo. No quedan servidores propios activos.

La navegación con Playwright se intentó, pero falló porque no existe
/Applications/Google Chrome.app/Contents/MacOS/Google Chrome. No se instaló un
navegador global y no se afirma validación visual ni de responsive en navegador.
La prueba de comportamiento disponible es renderizado real + HTTP real.

## Incidencias y revisión

El primer npm install fue interrumpido por el límite de tiempo y dejó el binario
SWC truncado. El primer build falló al intentar cargarlo; no se cambió a Webpack
ni se alteró el script requerido. npm ci encontró EACCES en el caché compartido.
Se repitió ci con caché local ignorado y el build nativo pasó sin warnings.
No se cambió la propiedad del caché global.

Autorrevisión: scope limitado a #1, scripts requeridos intactos, versiones exactas,
sin secretos ni fuentes remotas, copy honesto, plan original preservado y salida
generada ignorada. La revisión independiente queda para el controlador; no se
delegó trabajo ni se publicaron cambios remotos.
