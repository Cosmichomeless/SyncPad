# #54 · Sanear el rich text y los enlaces

## Objetivo

Que abrir una nota compartida nunca ejecute contenido malicioso, y que el formato
permitido (negrita, listas, enlaces) siga funcionando.

## Modelo de amenaza

Cualquier miembro de una nota puede escribir en el documento Yjs compartido lo que
quiera, saltándose la interfaz: atributos de texto arbitrarios, enlaces
`javascript:`/`data:`, objetos incrustados. Los demás miembros abren esa nota con
su sesión, así que el riesgo es XSS entre usuarios.

## Defensa en tres capas

| Capa | Dónde | Qué hace |
| --- | --- | --- |
| Alta del enlace | `setLink` / `sanitizeLinkUrl` (frontend) | solo `http:`, `https:`, `mailto:`; sin credenciales; ≤ 2048 caracteres; se guarda la URL normalizada |
| **Servidor** (nuevo) | `assertValidNoteUpdate` (`shared/src/document.ts`) | rechaza el update completo si añade una marca no permitida o contenido incrustado |
| Pintado | `readBlocks` + `RichPreview` (frontend) | lista blanca de marcas, `href` revalidado y todo como elementos React / texto escapado, nunca HTML |

La capa de pintado sigue siendo la barrera definitiva: el servidor no puede
reescribir un update de Yjs (sería otro update distinto), así que **rechaza** en
lugar de «limpiar», y el cliente nunca confía en lo que recibe.

## Política de marcas (`shared/src/rich-text-policy.ts`)

- `bold`: booleano, o `null` para quitarla.
- `link`: cadena que supere `sanitizeLinkUrl`, o `null` para quitarla.
- Cualquier otra clave (`onclick`, `style`, `class`…) o valor de otro tipo: prohibido.
- `insertEmbed` y cualquier inserción que no sea texto: prohibido.

Solo se juzga lo que **añade** el update (se observa el texto del documento de
prueba mientras se aplica), de modo que una nota con historial anterior a la
política no queda bloqueada y se puede seguir escribiendo en ella.

## Respuesta del servidor

Update con contenido prohibido ⇒ `sync-error` `invalid-message` (no reintentable)
y cierre `1003`, igual que cualquier mensaje malformado (#53): no se guarda, no se
difunde y los demás clientes de la sala no se ven afectados.

## Verificación

- `shared/src/document.test.ts` (+3): 11 variantes hostiles rechazadas
  (`javascript:` incluso con mayúsculas y saltos de línea, `data:`, credenciales,
  enlace no cadena, enlace larguísimo, atributo desconocido, `style`, negrita no
  booleana, marca en texto insertado, objeto incrustado) dejando intacto el
  documento del servidor; el formato legítimo pasa; el historial previo con marcas
  hostiles no bloquea; y un test de **deriva** entre la política compartida y la
  copia del frontend.
- `backend/tests/ws-malformed.test.ts` (+3 casos de la tabla): enlaces
  `javascript:`/`data:` y atributo `onclick` por WebSocket ⇒ `invalid-message`,
  `1003`, nada persistido, sala intacta, sin contenido en logs.
- `frontend/tests/rich-text.test.tsx` (+2): una nota con 12 enlaces hostiles,
  atributos `onclick`/`style` y HTML escrito como texto se pinta inerte (sin
  `href` fuera de http(s)/mailto, sin elementos activos ni manejadores en línea);
  y todo enlace que el cliente puede crear es exactamente uno que el pintado enlaza.
- Ya existentes (#39): `e2e/tests/rich-text.spec.ts` comprueba en navegador que un
  enlace `javascript:` se rechaza y el HTML escrito se muestra como texto sin diálogos.

## Límites

- Los clientes con la política antigua pintan con su propia lista blanca; la
  protección de servidor solo cubre notas nuevas escritas tras este cambio.
- Una región con una marca hostil **anterior** a la política, al escribir dentro de
  ella, hereda la marca y ese update se rechaza; la salida es borrar esa región.
- La política vive duplicada en el frontend (usa su propia copia de Yjs); la prueba
  de deriva evita que diverjan sin aviso.
- No hay una Content-Security-Policy específica para las notas; queda como mejora.
