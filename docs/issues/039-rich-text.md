# #39 · Formato enriquecido acotado

## Objetivo

Ampliar el editor básico con **negrita, listas y enlaces** que se sincronizan
entre clientes sin que la nota pueda ejecutar scripts.

## Decisión de diseño

El texto sigue siendo el `Y.Text` `content` del esquema v1. El formato son
**atributos de texto de Yjs** (`bold: true`, `link: "<url>"`) y las listas son
líneas que empiezan por `- `:

- Es un cambio **aditivo** según la política de #35: un cliente o servidor que
  no conoce las marcas sigue leyendo exactamente el mismo texto plano y fusionando
  igual; `schemaVersion` **no sube**. Nada de lo anterior (offline, undo #36,
  escenarios #37, copia local) cambia.
- Las marcas se fusionan como los caracteres (son items de Yjs), así que dar
  formato y escribir a la vez converge igual que dos ediciones de texto.
- Se descartó migrar a un árbol ProseMirror/Tiptap (`Y.XmlFragment`): obligaba a
  subir el esquema a v2, perder la edición con `textarea` y reescribir undo, pruebas
  y persistencia. Si algún día se necesita formato por bloques (títulos, tablas), esa
  sí sería una subida de versión con migración (ver #35).

## Cómo funciona

- `frontend/src/lib/rich-text.ts`: `toggleBold`, `setLink`, `removeLink`,
  `toggleList` (operan sobre la selección del `textarea` dentro de una
  transacción con origen `LOCAL_EDIT_ORIGIN`, así que se envían, se persisten y se
  deshacen como cualquier edición local) y `readBlocks` (convierte el documento en
  párrafos y listas).
- La selección nunca parte un par sustituto (emoji). La lista edita **línea a
  línea** (insertar/borrar `- `) para no reescribir el resto del texto.
- `frontend/src/app/rich-preview.tsx` muestra la **vista con formato** debajo del
  `textarea`; barra de herramientas «Formato» con Negrita, Lista, Enlace y Quitar
  enlace.
- Teclear dentro de un tramo en negrita hereda la negrita (comportamiento estándar
  de Yjs); el marcador de lista se inserta sin marcas.

## Seguridad

- **No se genera HTML.** La vista son elementos de React y nodos de texto
  escapados; no hay `dangerouslySetInnerHTML`. `<script>` o `<img onerror>`
  escritos en una nota se ven como texto.
- **Lista blanca de marcas.** Solo `bold === true` y `link` válido se leen; cualquier
  otro atributo (`onclick`, `style`, objetos…) se ignora, venga de quien venga.
- **Enlaces.** `sanitizeLinkUrl` solo admite `http:`, `https:` y `mailto:` (se
  rechazan `javascript:` en cualquier mezcla de mayúsculas o con saltos de línea,
  `data:`, `vbscript:`, `file:`, rutas relativas, URLs con credenciales y las de
  más de 2048 caracteres). Se valida **al crear** el enlace y **al pintar**, porque
  un cliente malicioso puede escribir cualquier atributo en el documento
  compartido. Los enlaces llevan `rel="noopener noreferrer nofollow"` y `target="_blank"`.
- El servidor rechaza los updates con marcas no permitidas (#54, ver `054-sanitize-rich-text.md`).

## Verificación

- `frontend/tests/rich-text.test.tsx` (14): negrita sincronizada con texto
  intacto, alternar negrita, selección vacía, emoji, enlaces (alta, normalización,
  baja), lista de URL rechazadas, atributos hostiles de otro cliente, listas
  (alternar, `<ul>`, edición concurrente), ediciones de texto que conservan marcas,
  convergencia formato+texto concurrentes, undo solo local y compatibilidad v1.
- `shared/src/document.test.ts` (+1): un documento con marcas es un update v1
  válido para el servidor.
- `e2e/tests/rich-text.spec.ts` (2, Playwright): A pone negrita y lista, B pone un
  enlace, ambos lo ven y sobrevive a recargar; un enlace `javascript:` se rechaza y
  el HTML escrito se muestra como texto sin diálogos.

## Límites

- Formato acotado a tres marcas; no hay cursiva, títulos ni listas numeradas.
- El texto se edita en un `textarea` y el resultado se ve en la vista de abajo; no
  es un editor WYSIWYG.
- La lista usa un prefijo textual (`- `): un cliente antiguo ve esos guiones en
  claro. Las marcas de otros formatos podrían añadirse sin subir versión mientras
  sean atributos.
- Las marcas se restringen en servidor (#54) pero no en cantidad; solo las acota el tamaño de la nota (#48).
