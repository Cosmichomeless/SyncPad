# #29 · Estado de sincronización accesible

## Objetivo

Mostrar al usuario, de forma veraz y accesible, si la nota está sin conexión,
reconectando, sincronizando o al día, y ofrecer un reintento manual que nunca
borre cambios locales.

## Diseño

### Componente (`frontend/src/app/note-sync-status.tsx`)

Presenta el estado del controlador de #28; no calcula nada propio.

| Estado | Etiqueta | Punto |
| --- | --- | --- |
| `offline` | Sin conexión | gris |
| `reconnecting` | Reconectando | ámbar |
| `syncing` | Sincronizando | ámbar |
| `up-to-date` | Al día | verde |

- Una única región `role="status"` (`aria-live="polite"`, `aria-atomic`) con la
  etiqueta; el punto de color es decorativo (`aria-hidden`), así que el estado
  nunca depende solo del color. El aviso de cambios pendientes de la página dejó
  de ser una segunda región viva para no anunciar dos veces.
- «Reintentar conexión» aparece en cualquier estado distinto de `up-to-date` y
  llama a `retry()` del controlador, que reconecta sin tocar el `Y.Doc` ni la
  persistencia local.
- La disponibilidad real de red se lee de `online`/`offline` del navegador en
  `page.tsx`. Con el navegador sin red el botón está deshabilitado y aparece el
  motivo («Se reanudará automáticamente al volver la red.»), porque reintentar no
  puede tener éxito y el controlador reconecta solo al volver `online`.

### Desviación respecto al plan

El plan decía deshabilitar el reintento en `offline`. Pero `offline` también es
el estado tras un `sync-error` no reintentable (servidor sano, sincronización
rechazada), y ahí el reintento manual es justo la acción útil. Por eso el botón
solo se deshabilita cuando `offline` coincide con «el navegador no tiene red».

### Página (`frontend/src/app/page.tsx`)

El título de edición y el estado comparten cabecera. Un `syncError` (rechazo
no reintentable) se muestra con `role="alert"` y se limpia al reintentar o al
cambiar de nota. El aviso «Cambios locales guardados en este dispositivo;
pendientes de confirmar con el servidor» sigue mostrándose mientras haya
revisión local sin `ack`.

## Verificación

- `frontend/tests/sync-status.test.tsx` (6 tests): etiquetas exactas y una sola
  región viva, punto decorativo, presencia del reintento, deshabilitado solo sin
  red del navegador con su explicación y delegación del clic.
- `frontend/tests/note-sync.test.tsx`: 3 tests añadidos para el estado del
  controlador y el reintento manual (19 en total). Frontend 90/90, lint y
  typecheck limpios.
- Chromium (`e2e/acceptance/issue-029-sync-status.mjs`):
  - Sin red del navegador: etiqueta «Sin conexión», reintento deshabilitado con
    su motivo; al volver la red, «Al día».
  - Caída real del backend (se detiene el proceso): «Reconectando», reintento
    habilitado, aviso de pendiente visible, el texto escrito durante la caída se
    conserva.
  - Con el backend de vuelta y pulsando «Reintentar conexión»: «Al día», aviso
    de pendiente desaparecido, y una recarga completa recupera el texto escrito
    durante la caída.
  - Una sola región `status` en la página y reintento ausente cuando está al día.
- Los scripts de #27, #28 y #30 se actualizaron a las etiquetas de
  `.sync-status p` y siguen en verde.

## Límites

- El navegador puede decir `online` sin tener salida real; el estado lo
  corrige el fallo de conexión (pasa a `reconnecting` con reintentos), no una
  detección previa.
- El script de aceptación detiene el backend de pruebas con
  `lsof -ti tcp:4001 -sTCP:LISTEN`; sin `-sTCP:LISTEN` `lsof` también devuelve
  los procesos cliente (incluido el servicio de red de Chromium, que perdería las
  cookies de sesión).
- Los estados de error de almacenamiento local siguen siendo independientes del
  estado de conexión (#25).
