# Issue #24 — Convergencia y reinicio

## Alcance

La prueba final conecta dos clientes a la misma nota, verifica que una edición
Yjs converge en el segundo cliente, cierra el servidor y vuelve a iniciarlo con
el mismo `SyncStore`. El cliente posterior reconstruye el contenido persistido y
recibe únicamente la presencia de su conexión actual.

## Verificación

```sh
npm --prefix backend test
npm --prefix backend run lint
npm --prefix backend run typecheck
npm --prefix backend run build
```

La prueba usa un store persistente en memoria para aislar el protocolo; la
implementación PostgreSQL de #21 proporciona el mismo contrato en producción.