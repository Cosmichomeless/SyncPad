# #56 · Revisión de flujos de teclado y lector de pantalla

## Objetivo

Que crear, abrir y editar una nota sea posible sin ratón y que la presencia y el
estado de sincronización se entiendan sin ver la pantalla.

## Auditoría y cambios

| Hallazgo | Cambio |
| --- | --- |
| No había enlace de salto ni destino de foco para el contenido | `Saltar al contenido` en `layout.tsx` (visible solo con foco) → `main#principal` (`tabIndex=-1`) |
| El foco visible dependía del estilo del navegador | `:focus-visible` explícito (contorno de 3 px, contraste alto) y `main:focus` sin contorno |
| Crear u abrir una nota dejaba el foco en el botón: había que tabular hasta el editor | `openNote` marca la intención; al poder editarse la nota (o ser de solo lectura) el foco pasa al editor. Solo ocurre al **abrir a propósito**, nunca por una carga o reconexión |
| El editor no decía de qué nota era | `aria-describedby` apunta al título (`#editor-title`) |
| Paneles sin nombre | `aside` «Workspaces», `section` «Notas» y grupos «Lista de workspaces/notas/Notas eliminadas…» |
| Formulario de enlace: no recibía el foco ni tenía salida con teclado | `autoFocus`, `Escape` cierra y devuelve el foco al botón «Enlace»; al aplicar, el foco vuelve al editor; `aria-controls` mientras está abierto |
| La presencia solo se veía; entrar/salir alguien no se anunciaba | Resumen `role="status"` (`aria-live="polite"`, atómico): «2 participantes conectados: yo (tú), ana» |
| El cursor remoto era un `span` con `aria-label` (no fiable) | Barra decorativa `aria-hidden` + texto real `sr-only` « cursor » |
| Contraste insuficiente de textos secundarios (`#6d7d85`, `#62727a`) | `#4b5a63` |

Ya estaba bien y se conserva: el estado de sincronización es una única región
viva con texto (`role="status"`, el punto es decorativo), los errores usan
`role="alert"`, la nota activa lleva `aria-current`, la barra de formato es un
`role="toolbar"` con botones nativos y todos los campos tienen etiqueta.

## Verificación

- `frontend/tests/presence.test.tsx` (+1): resumen vivo, caret como texto y sin
  `aria-label` en el `span`.
- `frontend/tests/sync-status.test.tsx` (existente): cada estado con su texto en
  una única región viva.
- `e2e/tests/keyboard-accessibility.spec.ts` (3): crear (Enter) → foco en el
  editor → escribir → «Al día»; abrir otra nota con Enter y Espacio; enlace de
  salto; contorno de foco computado; formulario de enlace con Escape; región
  viva de sincronización y resumen de presencia.

## Límites

- Revisión contra el árbol de accesibilidad de Playwright, no una auditoría con
  lector de pantalla real (VoiceOver/NVDA) ni con axe-core; queda como paso
  previo a una release pública.
- Al cambiar de nota solo se anuncian el foco y la descripción del editor.
- El tema oscuro y el zoom/reflow no se han revisado.
