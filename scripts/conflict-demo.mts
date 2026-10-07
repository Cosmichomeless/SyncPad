// Reproducible conflict (docs/releases/v1.0.0.md, #69): two replicas edit the same word while
// disconnected, then reconnect. Nobody wins: both versions are kept and both replicas hold the
// exact same Yjs state. No server, no database, no network:
//   cd backend && npx tsx ../scripts/conflict-demo.mts
import { assertConverged, createPeer, exchange, forkPeer } from '../shared/src/testing/convergence.js';

const ana = createPeer('Ana');
ana.content.insert(0, 'el perro corre');
const luis = forkPeer('Luis', ana);
console.log(`Con conexión, las dos réplicas tienen: "${ana.content.toString()}"`);

// Sin conexión: cada una reemplaza «perro» a su manera.
ana.content.delete(3, 5);
ana.content.insert(3, 'lobo');
luis.content.delete(3, 5);
luis.content.insert(3, 'loro');
console.log(`Sin conexión, Ana ve:  "${ana.content.toString()}"`);
console.log(`Sin conexión, Luis ve: "${luis.content.toString()}"`);

// Reconexión: cada una envía a la otra solo lo que le falta, como el protocolo `sync`.
exchange(ana, luis);
assertConverged([ana, luis], 'after reconnecting');
const merged = ana.content.toString();
console.log(`Tras reconectar, ambas ven: "${merged}"`);

if (!merged.includes('lobo') || !merged.includes('loro')) {
  console.error('FALLO: se perdió una de las dos versiones');
  process.exit(1);
}
console.log('OK: convergen al mismo texto y se conservan las dos versiones (sin «último gana»).');
