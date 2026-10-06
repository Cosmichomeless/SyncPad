# #43 · Pruebas de la interfaz de edición y colaboración

## Objetivo

Cubrir con pruebas la experiencia compartida: formato, presencia y gestión de
miembros, con **cuentas distintas** y no solo con dos pestañas de la misma cuenta.

## Mapa de cobertura

| Criterio | Dónde se prueba |
| --- | --- |
| Un cambio de formato aparece en dos clientes | `e2e/tests/rich-text.spec.ts` (misma cuenta) y `e2e/tests/collaboration-ui.spec.ts` (propietario ⇄ miembro, en ambos sentidos) |
| Presencia y cursores | `e2e/tests/presence.spec.ts` (una cuenta, varias pestañas) y `collaboration-ui.spec.ts` (dos cuentas: cada una se ve «(tú)» y ve a la otra por su email; la selección remota se resalta) |
| OWNER y MEMBER ven controles acordes | `frontend/tests/members.test.tsx` (vista pura por rol) y `e2e/tests/invitations.spec.ts` / `collaboration-ui.spec.ts` (flujo real con invitación) |
| Permisos del servidor, no solo de la UI | `invitations.spec.ts` (la API responde `403` al miembro) y `backend/tests/workspace-http.test.ts` |

## El e2e nuevo

`collaboration-ui.spec.ts` monta el escenario completo con la interfaz:

1. El propietario crea workspace y nota, escribe y **invita por email**.
2. El invitado se registra desde el enlace, acepta y abre la nota.
3. Ambos aparecen en «Participantes conectados» (el email va en `title`).
4. El propietario pone «mundo» en negrita → el miembro lo ve y ve su selección.
5. El miembro pone «hola» en negrita → el propietario ve las dos negritas; ambos
   quedan «Al día».
6. Controles: el propietario ve «Crear enlace de invitación» y «Quitar a …» (nunca
   sobre sí mismo); el miembro no ve ninguno y lee «Solo un propietario puede
   invitar o quitar miembros.».

## Cambio de producto descubierto al probar

La lista de miembros del propietario no se enteraba de que alguien había aceptado
la invitación hasta recargar. Ahora el panel se **refresca al recuperar el foco de
la ventana y cada 20 s mientras la pestaña es visible**.

## Límites

- La presencia entre cuentas se comprueba con dos clientes; escenarios con muchos
  participantes simultáneos se tratan en #47/#48.
