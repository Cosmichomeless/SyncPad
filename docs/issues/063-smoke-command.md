# #63 · Comando de humo local con varios clientes

## Objetivo

Un solo comando que levante el stack local y compruebe en unos segundos que lo
esencial funciona de extremo a extremo: crear una nota, conectar dos clientes y
verificar que se sincronizan.

## Uso

```bash
sh scripts/smoke.sh
```

Desde la raíz del repositorio y con las dependencias instaladas
(`npm --prefix backend ci`). El script:

1. Si no hay `DATABASE_URL`, carga `.env` (si existe) y arranca PostgreSQL con
   `docker compose up -d --wait postgres`. Si `DATABASE_URL` ya viene dada, usa
   esa base y **no toca Compose**.
2. Ejecuta las migraciones (`npm --prefix backend run migrate`), así que sirve
   tras levantar Compose desde cero: una base vacía queda lista sola.
3. Arranca el backend en `SMOKE_PORT` (3101 por defecto, para no chocar con
   `npm run dev` en 3001) con `CORS_ORIGIN=$SMOKE_ORIGIN`.
4. Lanza el recorrido (`backend/smoke/journey.ts`) y, pase o falle, para el
   backend que él mismo arrancó. Si falla, imprime las últimas 40 líneas de su
   log.

Para probar un stack que ya está corriendo (Compose completo, otro host) basta
con apuntar el recorrido a él; no se arranca ni se migra nada:

```bash
SMOKE_API_URL=http://127.0.0.1:3001 sh scripts/smoke.sh
```

| Variable | Por defecto | Para qué |
| --- | --- | --- |
| `DATABASE_URL` | `.env`, y si no, la de Compose | Base de datos; si se da, no se usa Compose |
| `SMOKE_PORT` | `3101` | Puerto del backend que arranca el script |
| `SMOKE_ORIGIN` | `http://127.0.0.1:3000` | `CORS_ORIGIN` del backend y `Origin` de los clientes |
| `SMOKE_API_URL` | (vacía) | Si se da, solo se ejecuta el recorrido contra esa URL |
| `SMOKE_WAIT_MS` | `30000` | Cuánto esperar a que `/health` responda |

Código de salida `0` si todo pasa y `1` si algo falla, con el mensaje del primer
fallo.

## Qué comprueba

Solo usa la API pública (HTTP y WebSocket), como lo haría el frontend:

1. `/health` responde.
2. Se registran tres cuentas (correos únicos por ejecución).
3. La primera crea un espacio de trabajo y una nota.
4. La segunda **no** puede conectarse a la nota hasta aceptar una invitación
   (`403` antes).
5. Dos clientes se conectan a la misma nota.
6. Cada uno escribe y el otro lo recibe: ambos leen «hola mundo» y el servidor
   confirma cada cambio con `ack`.
7. Una tercera conexión recibe la nota guardada desde el servidor.
8. La tercera cuenta, ajena a la nota, es rechazada (`403`).

## Decisiones

- **El recorrido reutiliza los clientes de las pruebas de integración**
  (`backend/integration/client.ts`: `Account`, `Replica`, `upgradeRefusal`),
  separados de `harness.ts` para que no arrastren servidor ni `pg`. Así hay un
  solo cliente WebSocket y un solo manejo de CSRF y cookies, y el recorrido usa
  los helpers de `@syncpad/shared` en lugar de `yjs`.
- **No necesita base limpia.** Cada ejecución crea cuentas nuevas, así que se
  puede repetir contra la base de desarrollo sin borrar nada ni chocar con
  correos anteriores. Lo que sí deja son esas filas de prueba (usuarios con
  correo `smoke-...@example.com`).
- **Puerto propio (3101).** Evita parar o confundir el backend de `npm run dev`.
- **Es `sh`, no un script de npm**, porque no hay `package.json` en la raíz;
  `npm --prefix backend run smoke:journey` ejecuta solo el recorrido.
- **No forma parte de `scripts/check.sh`**: necesita PostgreSQL y puertos libres.

## Límites

- No levanta el frontend ni un navegador: valida la capa de sincronización, no
  la interfaz (para eso están las pruebas de `e2e`).
- Usa el `5432` de Compose; si ya hay otro PostgreSQL en ese puerto, hay que
  pasar `DATABASE_URL` (se omite Compose) o parar el otro.
- El camino de Compose del script solo delega en `docker compose up -d --wait
  postgres`, la misma orden que `scripts/start-backend-local.sh`; no se pudo
  ejercitar de extremo a extremo en la máquina donde se desarrolló, porque el
  `5432` estaba ocupado por otro PostgreSQL. El resto (migraciones sobre una
  base vacía, backend, recorrido y limpieza) sí se ejecutó con `DATABASE_URL`.
- Deja filas de prueba (cuentas, un espacio de trabajo y una nota) en la base
  que use.
