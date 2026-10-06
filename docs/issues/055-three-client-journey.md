# #55 · Recorrido automatizado de tres clientes con uno sin red

## Objetivo

Cubrir en navegador real el caso más duro de convergencia: tres clientes, uno sin
red, ediciones concurrentes, un reinicio del servidor y reconexión.

## Escenario (`e2e/tests/three-clients-journey.spec.ts`)

Tres contextos de Chromium con la misma cuenta (A, B, C) sobre una nota con el texto
`base`:

1. **C pierde la red** y añade `C sin red` al final: solo existe en su dispositivo
   (indicador de cambios pendientes).
2. **A y B, conectados, editan a la vez** en puntos distintos: A escribe
   `A al inicio` al principio y B `B al final` al final. Cada uno escribe en su
   posición con el cursor (no sustituye el texto entero: sustituirlo borraría lo
   que el otro acaba de escribir, y eso no es una edición concurrente). Esperan
   «Al día», es decir, el `ack` del servidor, que solo llega tras guardar en
   PostgreSQL.
3. **Se reinicia el backend** (`SIGTERM` al proceso y arranque de uno nuevo en el
   mismo puerto y base de datos). A y B pierden el socket; B escribe
   `B durante la caída`, que queda pendiente.
4. Al volver el servidor, **A y B reconectan solos**, no han perdido nada de lo
   confirmado y el cambio hecho durante la caída llega a A.
5. **C recupera la red** y sube lo suyo.

## Qué se comprueba

- Los tres clientes acaban con **exactamente el mismo texto**.
- Cada cambio (`A al inicio`, `B al final`, `B durante la caída`, `C sin red`)
  aparece **una sola vez**: sin pérdidas ni duplicados.
- Todo lo confirmado antes del reinicio sigue en la nota después.
- C no queda con cambios pendientes.
- Un cuarto cliente nuevo que carga desde el servidor ve el mismo texto final.

## Reinicio del servidor desde la prueba

Playwright arranca el backend con `webServer`, pero no sabe reiniciarlo. Los
helpers `stopBackend` y `startBackend` (`e2e/tests/helpers.ts`) paran el proceso
que escucha en el puerto 4001 y arrancan otro igual (misma `DATABASE_URL`,
`CORS_ORIGIN`). El nuevo proceso no es de Playwright, así que se registra su PID y
`e2e/global-teardown.ts` lo detiene al terminar la ejecución: no quedan procesos
huérfanos.

## Relación con otras pruebas

- Convergencia a nivel de documento: `shared/src/scenarios.test.ts` y
  `convergence.test.ts` (#37).
- Reinicio con clientes reales sobre un almacén en memoria:
  `frontend/tests/server-recovery.test.tsx` (#46). Esta prueba añade el navegador,
  PostgreSQL real y un cliente sin red durante el reinicio.

## Límites

- Las tres sesiones son de la misma cuenta; el reparto entre usuarios distintos lo
  cubren las specs de invitaciones (#41) y colaboración (#43).
- El reinicio es ordenado (`SIGTERM`); una caída abrupta del proceso (`SIGKILL`) se
  cubre con los tests de reconexión a nivel de socket.
- La prueba necesita PostgreSQL (como el resto de specs) y `lsof` para localizar el
  proceso del backend.
