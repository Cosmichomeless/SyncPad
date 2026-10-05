# #26 — Shell anónimo offline (infraestructura parcial)

## Alcance

Esta entrega permite preparar el shell anónimo de producción para una recarga
sin red de `/`, sin query. No restaura usuario, workspaces, títulos ni selección
de notas; la navegación privada pertenece a #30. #25 conserva documentos Yjs,
pero esa persistencia por sí sola no permite volver a abrirlos tras una recarga
offline. #26 permanece abierta hasta integrar #30 y verificar el recorrido real
del navegador, incluido logout y cambio de cuenta.

## Generación y política

- `npm --prefix frontend run build` ejecuta automáticamente el postbuild antes
  de `next start`. Lee `.next/server/app/index.html`, `.next/BUILD_ID` y todos
  los archivos de `.next/static`; los publica como `/_next/static/...`.
- El generador exige que `/` esté prerenderizada sin revalidación en
  `.next/prerender-manifest.json`, exista el HTML y conserve el marcador del
  formulario anónimo (`auth-shell`), sin el de la vista privada
  (`workspace-shell`). La portada actual inicia usuario/listados vacíos y solo
  obtiene identidad en el cliente; no hay datos de cuentas en el HTML del build.
  Si se introduce renderizado privado en servidor, hay que revisar esta
  invariancia antes de ampliar el shell.
- `public/sw.js` y `public/offline-shell.html` son generados e ignorados por Git.
  No ejecutar solamente `next build` saltándose el postbuild ni desplegar el
  worker/shell de un build distinto al de sus assets.
- El caché `syncpad-shell-<BUILD_ID>` precarga exclusivamente el HTML anónimo y
  assets estáticos del mismo origen. La activación elimina solo cachés antiguos
  con ese prefijo y reclama clientes; no usa `skipWaiting`.
- El documento raíz usa red primero y solo cae al shell si `fetch` rechaza.
  HTTP 401/403/404/500 se devuelven intactos, nunca como fallback. Las respuestas
  vivas de `/` no se escriben en CacheStorage. Si falta el shell, se devuelve
  `Response.error()`.
- Assets incluidos sin query usan caché primero; un miss usa red sin escribir
  la respuesta. API/auth/rutas privadas, otros orígenes, métodos no GET y
  solicitudes RSC (cabecera `RSC` o parámetro `_rsc`) no se interceptan.
- El componente de layout registra `/sw.js` con scope `/` solo en producción.
  Se necesita HTTPS o localhost, soporte de Service Worker y una primera visita
  online con instalación completada. La actualización sigue el ciclo normal
  de espera del navegador; no se fuerza una sustitución en páginas abiertas.

## Evidencia del implementador

Entorno: Node.js 22.16.0, npm 10.9.2, Next.js 16.3.8.

| Comprobación | Resultado |
| --- | --- |
| `npm --prefix frontend test` antes de implementar | RED: 19 tests previos pasan; falta el módulo generador |
| Regresión CLI de mapeo de assets antes de corregirlo | RED: rechaza `/.next/static/chunks/app.js` |
| `npm --prefix frontend test` final | 29/29 pasan, 0 fallos (10 nuevos tests) |
| `npm --prefix frontend run lint` | Exit 0, sin errores ni warnings |
| `npm --prefix frontend run typecheck` | Exit 0 |
| `npm --prefix frontend run build` | Exit 0; `/` estática y postbuild genera 12 assets |
| `npm --prefix frontend run typecheck` posterior | Exit 0 |
| Inspección de artefactos generados | Shell idéntico al HTML estático, anónimo; 9 referencias iniciales `/_next/static/`, ninguna ausente del precache |
| `git check-ignore` de ambos archivos generados | Ambos ignorados |

Los tests ejecutan el código real generado en VM con listeners, fetch y
CacheStorage simulados. Cubren precarga, exclusiones de privacidad/Flight,
rechazo de red, errores HTTP, hits/misses estáticos sin escrituras en runtime,
limpieza selectiva y claim. Tests de CLI con fixtures temporales verifican copia
exacta, URL pública de assets y rechazo de HTML ausente o root dinámica/ISR.
La importación del módulo ESM en tests es dinámica para conservar el runner
actual `tsx` sin cambiar la configuración del proyecto.

## Verificación en navegador del controlador principal

Se repitieron tests (29/29), lint, typecheck, build/postbuild y typecheck
posterior, todos correctos. Se reinició exclusivamente el Next de prueba
iniciado por este agente y se usó Chromium con Playwright CLI.

- Tras recarga online, `navigator.serviceWorker.controller` es verdadero.
- CacheStorage contiene un único caché SyncPad con 13 entradas: el shell
  anónimo y 12 assets `/_next/static/`.
- Red bloqueada con Playwright y recarga completa de `/`: título SyncPad,
  formulario de acceso y worker controlando la página; `navigator.onLine` falso.
- El shell cacheado no contiene el email ni contenido de la nota de prueba.
- No hay entradas `/auth`, `/workspaces` ni `/notes` en CacheStorage.

La restauración de notas/navegación privada y las pruebas de logout/cambio de
cuenta requieren #30. No se implementa caché de sesiones ni metadata privada
en este cambio. #26 permanece abierta hasta verificar esa aceptación completa.

Revisiones independientes de especificación y calidad: aprobadas. La única
observación menor era una fixture dinámica ausente; se añadió un manifest
con `dynamicRoutes['/']` y se comprobó su rechazo sin cambiar implementación.

## Integración de navegación #30 — aceptación pendiente

#30 añade identidad local bloqueable y metadata IndexedDB por usuario sobre
el shell anónimo existente, sin cambiar la política de CacheStorage ni
guardar respuestas privadas. Frontend 52/52 y backend 54/54 tests pasan; lint,
typecheck/build y postbuild/typecheck posterior del frontend también pasan.
La UI nueva no se ejercitó en navegador por el implementador; el controlador
aún debe comprobar recarga offline con notas, aislamiento A/B, logout en dos
pestañas y refresco de metadata sin sustituir Yjs. #26 sigue abierta.
Evidencia: [#30](030-offline-navigation.md).
