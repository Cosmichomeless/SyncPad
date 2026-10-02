# Issue #9 — API de registro, login y logout

## Alcance

El backend expone `POST /auth/register`, `POST /auth/login`, `GET /auth/me` y
`POST /auth/logout`. Registro y login devuelven el usuario público y una cookie de
sesión HttpOnly; `/auth/me` requiere una sesión válida y logout la revoca y limpia
la cookie.

Las credenciales inválidas responden 401 sin crear sesión. La configuración
estricta de `Secure`, CORS y defensa CSRF se completa en #10.

## Verificación

```sh
npm --prefix backend test
npm --prefix backend run lint
npm --prefix backend run typecheck
npm --prefix backend run build
```

La suite incluye flujo HTTP real de registro, consulta de usuario actual, logout,
revocación e intento de login inválido.