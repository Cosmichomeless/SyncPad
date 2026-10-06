import { applyNoteUpdate, encodeNoteState, encodeNoteStateVector } from '../document.js';
import { assertConverged, createPeer, createRandom, createServer, deliver, permutations, reconnect, type Peer } from './convergence.js';

/**
 * Property-style scenarios: a seeded generator produces a list of operations (edits, going offline
 * and online, partial delivery, reloads, duplicate deliveries) and a runner executes them against
 * real note documents and a merging relay. Whatever happens in between, once every client has
 * reconnected they must hold the same document. A failure always names the seed and prints the
 * operation list, so it can be replayed with `SYNC_SEED=<n>`.
 */

export type ScenarioOptions = {
  clients: number;
  steps: number;
  /** When false the scenario only inserts uniquely-tagged tokens, so none may ever be lost or duplicated. */
  deletes: boolean;
  /** Test-only fault injection used to prove that failures are reported with their seed. */
  relay?: { dropUploads?: boolean };
};

export const DEFAULT_OPTIONS: ScenarioOptions = { clients: 3, steps: 60, deletes: true };

export type Operation =
  | { kind: 'type'; client: number; at: number; text: string }
  | { kind: 'erase'; client: number; at: number; length: number }
  | { kind: 'disconnect'; client: number }
  | { kind: 'connect'; client: number }
  | { kind: 'push'; client: number }
  | { kind: 'pull'; client: number }
  | { kind: 'reload'; client: number }
  | { kind: 'replay'; from: number; to: number };

/** Texts include multi-unit characters, accents and newlines: Y.Text indexes UTF-16 units. */
const SNIPPETS = ['a', 'b', 'hola ', 'mundo', ' ', '\n', 'ñ', 'é', '🙂', 'x'.repeat(5)] as const;

export function generateScenario(seed: number, options: ScenarioOptions = DEFAULT_OPTIONS): Operation[] {
  const random = createRandom(seed);
  const operations: Operation[] = [];
  let token = 0;
  for (let step = 0; step < options.steps; step++) {
    const client = random.int(options.clients);
    const roll = random.int(100);
    if (roll < 40) {
      // Positions are fractions of the *current* length, resolved at run time, so the same list replays identically.
      const text = options.deletes ? random.pick(SNIPPETS) : `⟦${seed}.${token++}⟧`;
      operations.push({ kind: 'type', client, at: random.int(1_000_000), text });
    } else if (roll < 55 && options.deletes) {
      operations.push({ kind: 'erase', client, at: random.int(1_000_000), length: 1 + random.int(6) });
    } else if (roll < 63) operations.push({ kind: 'disconnect', client });
    else if (roll < 72) operations.push({ kind: 'connect', client });
    else if (roll < 82) operations.push({ kind: 'push', client });
    else if (roll < 92) operations.push({ kind: 'pull', client });
    else if (roll < 96) operations.push({ kind: 'reload', client });
    else {
      const to = (client + 1 + random.int(Math.max(1, options.clients - 1))) % options.clients;
      operations.push({ kind: 'replay', from: client, to });
    }
  }
  return operations;
}

export function describeOperation(operation: Operation): string {
  switch (operation.kind) {
    case 'type': return `C${operation.client} type ${JSON.stringify(operation.text)} @${operation.at}`;
    case 'erase': return `C${operation.client} erase ${operation.length} @${operation.at}`;
    case 'replay': return `C${operation.from} -> C${operation.to} replay full state`;
    default: return `C${operation.client} ${operation.kind}`;
  }
}

export class ScenarioFailure extends Error {
  constructor(readonly seed: number, readonly reason: string, readonly trace: string[]) {
    super(`scenario failed (seed ${seed}): ${reason}\nReplay with SYNC_SEED=${seed}\n${trace.join('\n')}`);
    this.name = 'ScenarioFailure';
  }
}

/** Insertions may land inside each other, so tokens are compared as a multiset of characters. */
const characters = (text: string) => [...text].sort().join('');

export type ScenarioResult = { text: string; trace: string[] };

export function runScenario(seed: number, options: ScenarioOptions = DEFAULT_OPTIONS): ScenarioResult {
  const operations = generateScenario(seed, options);
  const trace: string[] = [];
  const server = createServer();
  // Yjs breaks ties between concurrent inserts by client id; fixing the ids makes the whole run replayable.
  let identities = 0;
  const spawn = (name: string, base: Uint8Array) => {
    const peer = createPeer(name, base);
    peer.doc.clientID = ((Math.imul(seed, 2654435761) + ++identities * 7919) >>> 0) || 1;
    return peer;
  };
  const clients: Peer[] = Array.from({ length: options.clients }, (_, index) => spawn(`C${index}`, encodeNoteState(server.doc)));
  const online = clients.map(() => true);
  const inserted: string[] = [];
  const upload = (client: Peer) => { if (!options.relay?.dropUploads) deliver(client, server); };

  try {
    operations.forEach((operation, index) => {
      trace.push(`#${index} ${describeOperation(operation)}`);
      switch (operation.kind) {
        case 'type': {
          const peer = clients[operation.client]!;
          const length = peer.content.length;
          peer.content.insert(length === 0 ? 0 : operation.at % (length + 1), operation.text);
          if (!options.deletes) inserted.push(operation.text);
          break;
        }
        case 'erase': {
          const peer = clients[operation.client]!;
          const length = peer.content.length;
          if (length === 0) break;
          const from = operation.at % length;
          peer.content.delete(from, Math.min(operation.length, length - from));
          break;
        }
        case 'disconnect': online[operation.client] = false; break;
        case 'connect':
          online[operation.client] = true;
          upload(clients[operation.client]!);
          deliver(server, clients[operation.client]!);
          break;
        case 'push': if (online[operation.client]) upload(clients[operation.client]!); break;
        case 'pull': if (online[operation.client]) deliver(server, clients[operation.client]!); break;
        case 'reload': {
          // A reload keeps the persisted state (including unsent edits) but starts a new replica identity.
          const old = clients[operation.client]!;
          clients[operation.client] = spawn(old.name, encodeNoteState(old.doc));
          old.doc.destroy();
          break;
        }
        case 'replay': deliver(clients[operation.from]!, clients[operation.to]!); break;
      }
    });

    // Everyone comes back and reconnects until nothing changes any more.
    trace.push('-- all clients reconnect');
    let signature = '';
    for (let round = 0; round < options.clients + 2; round++) {
      for (const client of clients) {
        upload(client);
        deliver(server, client);
      }
      const next = [server, ...clients].map((peer) => Buffer.from(encodeNoteStateVector(peer.doc)).toString('base64')).join('|');
      if (next === signature) break;
      signature = next;
    }

    const everyone = [server, ...clients];
    assertConverged(everyone, 'after reconnecting:');
    const text = server.content.toString();

    // Idempotence: delivering full states again changes nothing.
    for (const from of everyone) for (const to of everyone) if (from !== to) applyNoteUpdate(to.doc, encodeNoteState(from.doc));
    assertConverged(everyone, 'after redelivering every state:');
    if (server.content.toString() !== text) throw new Error('redelivery changed the text');

    // Order independence: a fresh replica fed the client states in any order ends in the same text.
    const states = clients.map((client) => encodeNoteState(client.doc));
    const orders = clients.length <= 4 ? permutations(states) : [states, [...states].reverse()];
    for (const order of orders) {
      const fresh = createPeer('fresh');
      for (const state of order) applyNoteUpdate(fresh.doc, state);
      if (fresh.content.toString() !== text) throw new Error(`delivery order changed the text: ${JSON.stringify(fresh.content.toString())}`);
    }

    // Insert-only scenarios must keep every token exactly once.
    if (!options.deletes) {
      const expected = characters(inserted.join(''));
      if (characters(text) !== expected) throw new Error(`insertions lost or duplicated: expected ${expected.length} characters, found ${text.length}`);
    }
    return { text, trace };
  } catch (error) {
    if (error instanceof ScenarioFailure) throw error;
    throw new ScenarioFailure(seed, error instanceof Error ? error.message : String(error), trace);
  }
}
