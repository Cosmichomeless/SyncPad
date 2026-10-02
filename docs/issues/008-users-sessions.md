# Issue #8 — Usuarios y sesiones

## Alcance

La migración `002-access.sql` crea usuarios con email único y sesiones revocables
con expiración. Las contraseñas usan `scrypt` con salt aleatorio; los tokens de
sesión solo se almacenan como hashes SHA-256 y nunca como texto plano.

El servicio de autenticación separa registro, verificación de credenciales,
creación de sesión, consulta de sesión activa e invalidación. Las rutas HTTP se
añaden en #9 y las políticas de cookie, CSRF y CORS en #10.

## Verificación

```sh
npm --prefix backend test
npm --prefix backend run lint
npm --prefix backend run typecheck
npm --prefix backend run build
```

La migración se aplica con `npm --prefix backend run migrate` después de iniciar
PostgreSQL. La prueba real de base de datos requiere Docker Desktop activo.