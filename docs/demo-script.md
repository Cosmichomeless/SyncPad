# Guion de demo de SyncPad

Guion de unos 10 minutos para enseñar SyncPad en una entrevista o en un
portfolio. Cada paso indica qué se ve, qué demuestra y qué prueba automática
cubre el mismo comportamiento, para poder respaldarlo con el código. La
arquitectura completa está en [architecture.md](architecture.md).

## Estado de la demo pública

- **URL pública de la demo: pendiente de desplegar.** El despliegue gratuito
  (Render + Neon) está preparado y ensayado en local
  ([deployment.md](deployment.md)); hasta publicarlo, este guion se ejecuta en local.
- **Release v1.0.0: pendiente.**
- Capturas: hay cinco en [`screenshots/`](screenshots/), generadas con datos
  sembrados (véase el README). La grabación de pantalla sigue pendiente.

## Preparación (local)

Requisitos: Node.js, Docker (para PostgreSQL) y dos ventanas de navegador. Para
que las dos sesiones no compartan cookies, usa una ventana normal y una de
incógnito, o dos perfiles/navegadores distintos.

```bash
cp .env.example .env
scripts/start-backend-local.sh     # Postgres + migraciones + backend en :3001
npm --prefix frontend run dev      # frontend en http://localhost:3000
```

Para el paso del service worker hace falta el build de producción
(`npm --prefix frontend run build` y arrancarlo); el worker solo se registra en
producción ([#26](issues/026-app-shell.md)). Para el paso de métricas, arranca
el backend con `METRICS_TOKEN` definido.

Ventana A = Ana (propietaria). Ventana B = Beto (invitado).

## Recorrido

### 1. Cuentas, workspace y nota (1 min)

1. En A, registra `ana@example.com` (contraseña de al menos 8 caracteres), crea
   un workspace y una nota «Acta de la reunión».
2. En B, registra `beto@example.com`.

Qué demuestra: cuentas con sesión por cookie HttpOnly y CSRF
([#9](issues/009-auth-api.md), [#10](issues/010-security-policy.md)).

### 2. Invitación y roles (1 min)

1. En A, genera una invitación al workspace. Copia el enlace (es de un solo uso).
2. En B, abre el enlace y acepta. Beto entra como miembro.
3. Muestra que Beto no ve los controles de propietario.

Respaldo: e2e `invitations.spec.ts` y `collaboration-ui.spec.ts`
([#41](issues/041-invitations-ui.md), [#43](issues/043-collaboration-ui-tests.md)).

### 3. Edición simultánea con presencia y cursores (1 min)

1. Abre la misma nota en A y en B y escribe en ambas a la vez.
2. Señala la barra de participantes y la selección del otro usuario sobre el
   texto.
3. Apunta el indicador de estado: «Al día» cuando todo está confirmado por
   el servidor.

Respaldo: e2e `presence.spec.ts`, `collaboration-ui.spec.ts`
([#40](issues/040-participants-cursors.md),
[#29](issues/029-sync-status.md)).

### 4. Rich text acotado (1 min)

1. En A, selecciona una palabra y pulsa Negrita; crea una lista con Lista; añade
   un enlace `https://…` con Enlace.
2. Comprueba que B lo ve al instante.
3. Prueba un enlace `javascript:alert(1)`: se rechaza. Escribe `<img onerror=…>`:
   se muestra como texto, no se ejecuta.

Respaldo: e2e `rich-text.spec.ts`; el servidor además rechaza marcas y enlaces
prohibidos ([#39](issues/039-rich-text.md),
[#54](issues/054-sanitize-rich-text.md)).

### 5. Sin red: editar, recargar y reconectar (2 min)

1. En B, corta la red (en las herramientas de desarrollo, «Offline»). El estado
   pasa a «Sin conexión».
2. En B, escribe un párrafo. En A, escribe otro distinto.
3. Recarga B estando sin red: la nota sigue ahí con lo escrito (IndexedDB y
   service worker, solo en el build de producción).
4. Restaura la red en B. Se reconecta con espera exponencial, sube lo que el
   servidor no tenía y recibe lo de A. Ambas ventanas muestran el mismo texto,
   sin duplicados.

Qué demuestra: un CRDT con sincronización por diferencia de vector de estado
([#28](issues/028-reconnection.md), [#25](issues/025-indexeddb.md)).

Respaldo: e2e `offline-reconnection.spec.ts`, `note-navigation.spec.ts`
([#31](issues/031-offline-e2e.md)) y el recorrido de tres clientes con reinicio
del servidor, `three-clients-journey.spec.ts`
([#55](issues/055-three-client-journey.md)).

### 6. Conflicto: dos personas reemplazan la misma palabra (1 min)

1. Escribe en la nota la frase «el perro corre» y espera a que ambas ventanas
   la tengan.
2. Corta la red en B. En A, cambia «perro» por «lobo»; en B, cambia «perro» por
   «loro».
3. Reconecta B. No gana ninguna de las dos: se conservan ambas versiones (por
   ejemplo «lobo» y «loro» juntas) y las dos ventanas ven lo mismo.

Mensaje a transmitir: no hay «último gana» ni se pierde trabajo; la fusión es
determinista. Las reglas, con sus límites, están en
[#38](issues/038-merge-rules.md); la convergencia se prueba por propiedades en
[#32](issues/032-concurrent-edits.md), [#33](issues/033-divergent-branches.md) y
[#37](issues/037-convergence-scenarios.md).

### 7. Deshacer solo lo propio (30 s)

1. Con A y B escribiendo, pulsa Ctrl/Cmd+Z en A.
2. Se deshace lo escrito por A; lo de B permanece.

Respaldo: e2e `undo-redo.spec.ts` ([#36](issues/036-scoped-undo.md)).

### 8. Nota eliminada mientras alguien está sin red (1 min)

1. Con B sin red y con cambios pendientes, A elimina la nota.
2. Restaura la red en B: la nota aparece como «Eliminada en el servidor», en
   solo lectura, con «Copia local recuperable». Muestra «Descargar copia
   (.txt)» y «Descartar copia local». No se recrea la nota ni se pierde el texto.

Respaldo: e2e `delete-while-offline.spec.ts`
([#34](issues/034-delete-while-offline.md)).

### 9. Aislamiento entre cuentas tras cerrar sesión (1 min)

1. En A, cierra sesión. La interfaz queda vacía al instante.
2. Entra con otra cuenta en el mismo navegador (también sin red): no aparece
   nada de Ana.
3. Si Ana vuelve a entrar, sus datos locales reaparecen. Dilo con franqueza: los
   datos locales se conservan sin cifrar, separados por usuario; es una
   decisión documentada y un límite conocido.

Respaldo: e2e `account-isolation.spec.ts`
([#52](issues/052-data-isolation.md)).

### 10. Operación: `/health` y `/metrics` (30 s)

```bash
curl -s http://localhost:3001/health
curl -s -H "Authorization: Bearer $METRICS_TOKEN" http://localhost:3001/metrics
```

`/metrics` responde 404 sin el token. Muestra `syncpad_connections_current`,
`syncpad_updates_total` y `syncpad_update_persist_ms`: métricas sin ids ni
contenido de notas ([#49](issues/049-observability.md)).

### 11. Accesibilidad por teclado (opcional, 30 s)

Crea, abre y edita una nota usando solo el teclado; el estado de sincronización
se anuncia como región viva. Respaldo: e2e `keyboard-accessibility.spec.ts`
([#56](issues/056-accessibility.md)).

## Qué contar al cierre

- Arquitectura: [architecture.md](architecture.md) (componentes, flujo de
  sincronización, modelo de datos, protocolo y seguridad).
- Seguridad: sesiones con hash, CSRF, CORS de un origen, permisos revalidados
  en conexiones abiertas, límites de carga y validación de payloads.
- Límites honestos: sin cifrado en reposo, una sola instancia del servidor y el
  benchmark con muchos editores concurrentes por encima del presupuesto
  ([#50](issues/050-benchmark.md)); ver
  [Límites conocidos](architecture.md#límites-conocidos).
- Demo pública y release v1.0.0: pendientes de crear las cuentas y desplegar ([deployment.md](deployment.md)).

## Tabla de respaldo automatizado

| Paso | Prueba end-to-end (`e2e/tests/`) |
| --- | --- |
| 2 | `invitations.spec.ts`, `collaboration-ui.spec.ts` |
| 3 | `presence.spec.ts`, `collaboration-ui.spec.ts` |
| 4 | `rich-text.spec.ts` |
| 5 | `offline-reconnection.spec.ts`, `note-navigation.spec.ts`, `three-clients-journey.spec.ts` |
| 7 | `undo-redo.spec.ts` |
| 8 | `delete-while-offline.spec.ts` |
| 9 | `account-isolation.spec.ts` |
| 11 | `keyboard-accessibility.spec.ts` |

Las pruebas e2e necesitan PostgreSQL y Chromium (ver
[Pruebas](architecture.md#pruebas)). El paso 6 (conflicto de reemplazo) y el
10 (métricas) se respaldan con pruebas unitarias y de integración del
backend y del frontend descritas en los documentos enlazados, no con un e2e
dedicado.
