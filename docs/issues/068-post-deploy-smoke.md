# #68 · Humo posterior al despliegue y recuperación

## Objetivo

Poder comprobar en un comando que la URL pública funciona como se diseñó (HTTPS, WSS,
cookie `Secure`, persistencia) y tener escrito qué hacer cuando algo falla.

## Qué se hace

- **`scripts/smoke-public.mts`**: recibe la URL pública, espera hasta 150 s a que el servicio
  despierte y ejecuta 10 comprobaciones (salud, web en el mismo origen, tres atributos de la
  cookie de sesión, WebSocket, edición con `ack` entre dos navegadores, persistencia tras
  desconectar todo y entrar con un navegador nuevo, y `Origin` ajeno rechazado). Código de
  salida 1 si falla alguna.
- **`docs/deployment.md`**: tabla de síntomas, reinicio, rollback, restauración paso a paso y
  rotación de secretos.

## Cómo se verifica

Ensayo local contra la imagen de #67 (`http://127.0.0.1:8080`, cookies `Secure` por defecto):
10 comprobaciones en verde. Con `COOKIE_SECURE=false` el humo falla en
«session cookie is Secure» y sale con 1.

## Límites

- No se ha ejecutado sobre la URL real: HTTPS y WSS (`wss://`) solo se prueban de verdad ahí.
  Contra `http://` el script comprueba que la cabecera lleva `Secure`, no que un navegador la
  acepte.
- El bucle de espera del arranque en frío no se ha ejercitado con un servicio dormido real.
- El humo crea una cuenta y una nota de prueba cada vez; no las borra.
- No hay vigilancia continua ni alertas: la comprobación es manual.
