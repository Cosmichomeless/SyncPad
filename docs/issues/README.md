# Índice de documentos por issue

Cada archivo documenta lo implementado para una issue de GitHub: objetivo,
decisiones, verificación y límites. Los números siguen el orden de las issues.
Para la visión de conjunto, ver [../architecture.md](../architecture.md).

Los documentos de las issues #57 en adelante (calidad automatizada, Docker, CI,
despliegue y publicación) se añadirán a este índice cuando existan.

## Fundamentos del proyecto

| Issue | Documento |
| --- | --- |
| #1 | [Base del frontend](001-frontend.md) |
| #2 | [Base HTTP/WebSocket en TypeScript](002-backend.md) |
| #3 | [PostgreSQL local](003-postgresql.md) |
| #4 | [Migraciones de esquema](004-migrations.md) |
| #5 | [Contratos compartidos](005-contracts.md) |
| #6 | [Entorno y scripts locales](006-environment.md) |
| #7 | [Arquitectura y puesta en marcha](007-architecture.md) |

## Cuentas, sesiones y seguridad de acceso

| Issue | Documento |
| --- | --- |
| #8 | [Usuarios y sesiones](008-users-sessions.md) |
| #9 | [API de registro, login y logout](009-auth-api.md) |
| #10 | [Cookies, CSRF y CORS](010-security-policy.md) |

## Workspaces y notas

| Issue | Documento |
| --- | --- |
| #11 | [Workspaces y memberships](011-workspaces-memberships.md) |
| #12 | [API de workspaces](012-workspace-api.md) |
| #13 | [Invitaciones y gestión de miembros](013-member-invitations.md) |
| #14 | [Metadata y ownership de notas](014-note-metadata.md) |
| #15 | [CRUD de notas](015-note-crud.md) |
| #16 | [UI de acceso y navegación](016-workspace-ui.md) |
| #17 | [Aislamiento de memberships y notas](017-isolation-tests.md) |

## Sincronización en tiempo real (Yjs y WebSocket)

| Issue | Documento |
| --- | --- |
| #18 | [Esquema versionado de documentos Yjs](018-yjs-schema.md) |
| #19 | [Autorización de salas WebSocket](019-websocket-authorization.md) |
| #20 | [Sincronización Yjs por WebSocket](020-yjs-sync.md) |
| #21 | [Persistencia de actualizaciones Yjs](021-yjs-persistence.md) |
| #22 | [Editor básico conectado a Yjs](022-yjs-editor.md) |
| #23 | [Awareness efímera](023-awareness.md) |
| #24 | [Convergencia y reinicio](024-convergence-restart.md) |

## Offline

| Issue | Documento |
| --- | --- |
| #25 | [Persistencia local de documentos Yjs en IndexedDB](025-indexeddb.md) |
| #26 | [Caché del shell de la aplicación](026-app-shell.md) |
| #27 | [Edición local desconectada](027-local-editing.md) |
| #28 | [Reconciliación al reconectar](028-reconnection.md) |
| #29 | [Estado de sincronización accesible](029-sync-status.md) |
| #30 | [Identidad local y navegación offline por usuario](030-offline-navigation.md) |
| #31 | [Pruebas E2E de recarga y reconexión sin red](031-offline-e2e.md) |
| #34 | [Borrado de una nota mientras otro cliente está sin red](034-delete-while-offline.md) |
| #55 | [Recorrido automatizado de tres clientes con uno sin red](055-three-client-journey.md) |

## Convergencia y reglas de fusión

| Issue | Documento |
| --- | --- |
| #32 | [Convergencia de ediciones simultáneas de texto](032-concurrent-edits.md) |
| #33 | [Fusión de ramas offline divergentes](033-divergent-branches.md) |
| #35 | [Versiones de esquema y compatibilidad entre clientes](035-schema-versions.md) |
| #36 | [Deshacer y rehacer acotados a las ediciones propias](036-scoped-undo.md) |
| #37 | [Escenarios de convergencia por propiedades](037-convergence-scenarios.md) |
| #38 | [Reglas de fusión y límites](038-merge-rules.md) |

## Editor y colaboración en la interfaz

| Issue | Documento |
| --- | --- |
| #39 | [Formato enriquecido acotado](039-rich-text.md) |
| #40 | [Participantes y cursores](040-participants-cursors.md) |
| #41 | [Invitaciones y gestión de miembros en la interfaz](041-invitations-ui.md) |
| #42 | [Pulido de la navegación entre workspaces y notas](042-navigation-polish.md) |
| #43 | [Pruebas de la interfaz de edición y colaboración](043-collaboration-ui-tests.md) |
| #56 | [Revisión de flujos de teclado y lector de pantalla](056-accessibility.md) |

## Operación del servidor y rendimiento

| Issue | Documento |
| --- | --- |
| #44 | [Snapshots periódicos de Yjs](044-snapshots.md) |
| #45 | [Compactación de actualizaciones antiguas](045-compaction.md) |
| #46 | [Recuperación tras una interrupción del servidor](046-server-recovery.md) |
| #47 | [Ráfagas de reconexión y clientes obsoletos](047-reconnect-bursts.md) |
| #48 | [Límites de tamaño y carga](048-limits.md) |
| #49 | [Métricas de sincronización y logs estructurados](049-observability.md) |
| #50 | [Benchmark de editores concurrentes](050-benchmark.md) |

## Auditoría de seguridad y robustez

| Issue | Documento |
| --- | --- |
| #51 | [Recomprobar permisos en las conexiones WebSocket](051-ws-permissions.md) |
| #52 | [Auditoría de aislamiento de datos entre cachés y salas](052-data-isolation.md) |
| #53 | [Pruebas con payloads maliciosos o malformados](053-malformed-payloads.md) |
| #54 | [Sanear el rich text y los enlaces](054-sanitize-rich-text.md) |

## Calidad, Docker, CI y publicación

Pendiente de documentar en este directorio: #57 en adelante. El despliegue y la
demo pública dependen de #64–#67.
