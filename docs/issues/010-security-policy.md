# Issue #10 — Cookies, CSRF y CORS

## Alcance

La configuración de seguridad valida un único `CORS_ORIGIN`, habilita credenciales
solo para ese origen y responde al preflight con métodos y cabeceras explícitas.
Los upgrades WebSocket con un origen distinto se rechazan.

Las cookies de sesión son HttpOnly y ajustan `SameSite` y `Secure` mediante
`COOKIE_SAME_SITE`, `COOKIE_SECURE` y `NODE_ENV`. El endpoint `GET /auth/csrf`
emite un token de doble cookie; las mutaciones de autenticación requieren que el
token de la cookie coincida con `X-CSRF-Token`.

## Verificación

```sh
npm --prefix backend test
npm --prefix backend run lint
npm --prefix backend run typecheck
npm --prefix backend run build
```

La suite cubre defaults locales, cookies seguras en producción, preflight, origen
rechazado y mutaciones sin CSRF.