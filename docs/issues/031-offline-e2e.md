# #31 · Pruebas E2E de recarga y reconexión sin red

## Objetivo

Automatizar el escenario «un cliente sin red mientras otro edita» en un
navegador real: el cliente desconectado puede editar y recargar, y al volver la
red ambos muestran el mismo contenido y estado *Al día*.

## Diseño

Suite Playwright (Chromium) en `e2e/`, sustituyendo como prueba repetible a los
scripts de aceptación manuales (que se conservan en `e2e/acceptance/` como
evidencia histórica de #27–#30).

- `e2e/playwright.config.ts`: un worker, `baseURL` `http://127.0.0.1:4000` y dos
  `webServer` (backend `:4001` y frontend construido `:4000`) con
  `reuseExistingServer`, de modo que un stack ya levantado no se reinicia.
  Requiere PostgreSQL (`DATABASE_URL`, por defecto `127.0.0.1:55432`).
- `e2e/tests/helpers.ts`: clientes con contextos aislados (IndexedDB y cookies
  propios), registro/login, apertura de nota y corte de red real con
  `context.setOffline` más el evento `offline` que escucha la página.
- `e2e/tests/offline-reconnection.spec.ts`:
  1. **Edita y recarga sin red, converge al volver.** A escribe, espera al
     service worker, pierde la red, edita (aviso de pendiente visible), recarga
     **sin red** y recupera su texto desde IndexedDB sin mostrar «Al día». B
     edita conectado. Al volver la red ambos muestran exactamente
     `Remoto: base compartida + cambios sin red`, los dos en «Al día» y sin
     aviso de pendiente.
  2. **Fusión de ediciones disjuntas y recarga completa.** A añade al final
     mientras B añade al principio; ambos convergen en `cero uno dos` y una
     recarga completa de B conserva el contenido del servidor sin duplicados.

Ejecución: `cd e2e && npm run install:browsers && npm test`. `npm run typecheck`
comprueba tipos. No forma parte de `scripts/check.sh` porque necesita Chromium y
PostgreSQL; se integrará en CI en #61/#62.

## Verificación

- 2/2 tests en verde (~17 s) y `tsc --noEmit` limpio.
- **Prueba de mutación (rojo real):** se eliminó del cliente la subida del diff
  tras el handshake (`note-sync.ts`); con esa regresión los dos tests fallan
  (`Al día` esperado, `Sincronizando` recibido). Con el código restaurado y el
  frontend reconstruido vuelven a pasar.

## Límites

- El corte de red usa `setOffline` de Chromium, que bloquea HTTP y WebSocket del
  contexto; no simula pérdida parcial de paquetes ni latencia (#47, #50).
- Las pruebas asumen el stack local y no limpian los datos que crean (emails
  únicos por ejecución).
- Solo Chromium; Firefox/WebKit quedan fuera.
