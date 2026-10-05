# #25 — Persistencia local de notas Yjs

## Entrega y alcance

Se añade `y-indexeddb` 9.0.12 para conservar las actualizaciones de cada nota
visitada. La clave es `syncpad:note:` seguida de la pareja JSON `[userId, noteId]`,
sin colisiones por delimitadores. Se requiere el ID del usuario autenticado.

El editor espera `whenSynced` antes de abrir el WebSocket, observa el contenido
Yjs y muestra el texto restaurado antes de sincronizar. Cambiar de nota limpia
el texto visible. El cleanup cancela callbacks antiguos, retira el observer,
cierra el socket y destruye la persistencia antes del documento; también
destruye el documento si el cierre del almacenamiento rechaza. Las referencias
solo se limpian si pertenecen a esa instancia. No se añade reconexión ni edición
desconectada. Seleccionar de nuevo la nota activa no borra su texto.

## Verificación ejecutada

Entorno: Node.js 22.16.0 y npm 10.9.2. Instalación desde `frontend/`:

```sh
npm install y-indexeddb --cache /tmp/syncpad-npm-cache --no-audit --no-fund
npm install -D fake-indexeddb --cache /tmp/syncpad-npm-cache --no-audit --no-fund
```

Ambas instalaciones finalizaron con código 0 y añadieron un paquete cada una.
Antes de implementar el módulo, `npm --prefix frontend test` produjo el RED
esperado: `Cannot find module '../src/lib/note-persistence'` (1 pass, 1 fail).
Después, con Yjs y persistencia reales sobre fake-indexeddb:

| Comando desde la raíz | Resultado |
| --- | --- |
| `npm --prefix frontend test` | 7/7 pass, 0 fail, código 0 |
| `npm --prefix frontend run lint` | Sin errores, código 0 |
| `npm --prefix frontend run typecheck` | Sin errores, código 0 |
| `npm --prefix frontend run build` | Compilación correcta; `/` y `/_not-found` estáticas, código 0 |
| `npm --prefix frontend run typecheck` tras build | Sin errores, código 0 |
| `git diff --check` | Sin errores |

Las pruebas cubren restauración sin red, dos usuarios con el mismo ID de nota,
dos notas del mismo usuario, claves inequívocas, hidratación repetida sin
duplicación y cancelación antes de hidratar. La prueba de portada sigue pasando.
Un primer lint rechazó el reset síncrono en el effect; se movió al callback de
selección, sin desactivar reglas. Una primera cadena de comprobaciones se
interrumpió por el timeout de 1 s; se repitió con 10 s y finalizó correctamente.

## Límites y revisión pendiente

No se verificó el flujo UI autenticado ni una recarga offline completa: los
servicios locales de los puertos 3000 y 3001 no estaban en ejecución (curl devolvió
000). Las pruebas verifican el documento local, no la recuperación de toda la
aplicación. El shell offline depende de #26 y la navegación/metadata de #30;
`/auth/me` y el listado todavía requieren red. #25 debe permanecer abierta hasta
verificar aceptación e integración. Las revisiones independientes de
especificación y calidad quedan como puerta previa a publicación.

Limitación de la dependencia: en `y-indexeddb/src/y-indexeddb.js`, `whenSynced`
solo se resuelve al emitir `synced`, y los errores de apertura/lectura no se
propagan a esa promesa. El `.catch` del editor no garantiza un mensaje ante
IndexedDB denegado y la dependencia puede generar un rechazo no manejado. El
cleanup local maneja un rechazo de `destroy()` sin conservar el documento,
pero el tratamiento completo del fallo de apertura necesita resolver esta
limitación antes de afirmar robustez ante almacenamiento denegado. Se mantiene
el límite de persistencia exacto del plan, sin usar campos privados de la librería.

Los datos locales no se borran al salir de la sesión ni están cifrados; separar
claves por usuario no protege frente a acceso al perfil del navegador. Las
modificaciones previas de tests backend, next-env.d.ts y globals.css quedan
fuera de esta entrega. No se publican cambios ni se cierra la issue.
