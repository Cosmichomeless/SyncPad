---
feature: anonymous-offline-shell
status: delivered-infrastructure
specs: []
plans:
  - plans/issue-026-shell.md
branch: issue/26-offline-shell
commits: 4e48ad4..1681360
---

# Interfaz offline — Informe de entrega

## What Was Built

El build genera un shell HTML anónimo y un service worker versionado para
recargar la interfaz básica sin red. #26 permanece abierta: recuperar notas
y navegación privada, con aislamiento tras logout, requiere #30.

## Architecture

El postbuild verifica que `/` es estática, copia su HTML y enumera los assets
de Next. El worker precachea solo esos archivos, recupera el shell ante rechazo
de transporte y no cachea respuestas vivas. La UI registra el worker solo en
producción; auth/API/RSC, peticiones externas y mutaciones no se interceptan.

### Design Decisions

Se usa el ciclo normal de actualización del worker, sin forzar sustituciones
en pestañas abiertas. Los archivos generados están ignorados y se regeneran
en cada build. Si se añade identidad renderizada en servidor, habrá que
revisar el contrato de shell anónimo antes de mantener esta estrategia.

## Usage

Ejecutar build y start del frontend, visitar online y esperar instalación.
La raíz controlada puede recargar su formulario de acceso sin red. El caché
de desarrollo no se habilita y aún no recupera identidad/navegación offline.

## Verification

29/29 tests, lint, typecheck, build/postbuild y typecheck posterior correctos.
En Chromium se verificó control del worker, recarga con red bloqueada y 13
entradas de caché sin identidad/contenido de prueba ni respuestas privadas.
Revisiones independientes de especificación y calidad aprobadas; la fixture
de raíz dinámica señalada como carencia menor quedó incluida y verificada.

## Journey Log

> Lecciones que informaron el diseño.

- [lesson] `.next/static` debe mapearse a URLs públicas `/_next/static/`.
- [lesson] Los fallos HTTP no son desconexión: no deben producir fallback de interfaz.

## Source Materials

| File | Role | Notes |
| --- | --- | --- |
| [Plan](../plans/issue-026-shell.md) | Implementación | Infraestructura |
| [Entrega](../docs/issues/026-app-shell.md) | Evidencias | Browser y límites |
