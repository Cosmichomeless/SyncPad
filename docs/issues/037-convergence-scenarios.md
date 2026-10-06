# #37 · Escenarios de convergencia por propiedades

## Objetivo

Complementar los casos escritos a mano (#32–#34) con escenarios generados:
secuencias aleatorias de ediciones, desconexiones y órdenes de entrega que
siempre deben acabar en el mismo documento, y que cuando fallan se pueden
reproducir exactamente.

## Cómo funciona

`shared/src/testing/scenario.ts`:

1. **Generador con semilla** (`generateScenario(seed, opciones)`, PRNG
   mulberry32). Produce una lista de operaciones que se interpreta sobre el
   documento *actual* (las posiciones son fracciones resueltas al ejecutar), de
   modo que la misma lista se reproduce idéntica:
   `type`, `erase`, `disconnect`, `connect`, `push`, `pull`, `reload`
   (réplica nueva a partir del estado persistido, como recargar la página) y
   `replay` (entrega duplicada de un estado completo, fuera de orden).
   Los textos incluyen saltos de línea, acentos y emoji (pares sustitutos).
2. **Ejecución** (`runScenario`) contra documentos de nota reales y un relé que
   solo fusiona, con el mismo diff por vector de estado que usa la reconexión.
   Los `clientID` se fijan a partir de la semilla: Yjs desempata inserciones
   concurrentes por `clientID`, así que sin esto el texto final variaría entre
   ejecuciones de la misma semilla.
3. **Propiedades comprobadas al final** (todos los clientes reconectan):
   - convergencia: mismo texto **y** misma estructura Yjs en servidor y clientes;
   - idempotencia: reentregar todos los estados no cambia nada;
   - independencia del orden: una réplica nueva alimentada con los estados en
     cualquier permutación (4 clientes o menos) obtiene el mismo texto;
   - solo inserciones: ningún carácter insertado se pierde ni se duplica.

## Fallos y reproducción

Un fallo lanza `ScenarioFailure` con la semilla, el motivo y la lista numerada
de operaciones:

```text
scenario failed (seed 7): peers diverged: ...
Replay with SYNC_SEED=7
#0 C1 type "hola " @512333
...
```

```bash
cd backend && SYNC_SEED=7 npx tsx --test ../shared/src/scenarios.test.ts   # un escenario
cd backend && SYNC_SEEDS=5000 npx tsx --test ../shared/src/scenarios.test.ts # barrido amplio
```

## Verificación

`shared/src/scenarios.test.ts` (7 tests): cuatro barridos de 300 semillas (3
clientes con borrados, 2 clientes con 150 pasos, 4 clientes con 30 pasos, solo
inserciones), determinismo por semilla, cobertura de todos los tipos de
operación y una prueba con un relé roto (descarta las subidas) que comprueba que
el fallo se detecta y menciona la semilla y la traza. Un barrido de 3000 semillas
pasa en ~20 s.

## Límites

- Modelan el protocolo de estado/diff, no el transporte WebSocket ni la
  persistencia real; eso lo cubren los tests de backend y e2e.
- El borrado de una nota entera (#34) y el cambio de esquema (#35) no entran en
  el generador: son transiciones del servidor, no de convergencia de texto.
- Deshacer/rehacer (#36) vive en el frontend (otra copia de Yjs) y se prueba allí.
