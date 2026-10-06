import * as Y from 'yjs';
import { applyNoteUpdate, createNoteDocument, encodeNoteState, encodeNoteStateSince, encodeNoteStateVector, type NoteDocument } from '../document.js';

/** One simulated client: a real note document plus a name for failure messages. */
export type Peer = NoteDocument & { name: string };

export function createPeer(name: string, base?: Uint8Array): Peer {
  const peer = { ...createNoteDocument(), name };
  if (base) applyNoteUpdate(peer.doc, base);
  return peer;
}

/** A peer that starts from `source`'s current state (what a client that synced earlier holds). */
export function forkPeer(name: string, source: Peer): Peer {
  return createPeer(name, encodeNoteState(source.doc));
}

/** Sends `from` -> `to` exactly what `to` is missing (the real reconnection diff). */
export function deliver(from: Peer, to: Peer) {
  applyNoteUpdate(to.doc, encodeNoteStateSince(from.doc, encodeNoteStateVector(to.doc)));
}

/** Bidirectional exchange of missing updates between two peers. */
export function exchange(a: Peer, b: Peer) {
  deliver(a, b);
  deliver(b, a);
}

/** Full-mesh exchange until nobody has anything new. */
export function settle(peers: Peer[]) {
  for (let round = 0; round < peers.length + 1; round++) {
    for (const from of peers) for (const to of peers) if (from !== to) deliver(from, to);
  }
}

/** Same item structure and delete set, not only the same visible text. */
export function sameYjsState(a: Peer, b: Peer) {
  return Y.equalSnapshots(Y.snapshot(a.doc), Y.snapshot(b.doc));
}

export function assertConverged(peers: Peer[], context = '') {
  const [first, ...rest] = peers;
  if (!first) return;
  for (const peer of rest) {
    if (peer.content.toString() !== first.content.toString() || !sameYjsState(first, peer)) {
      throw new Error(
        `${context} peers diverged: ${first.name}=${JSON.stringify(first.content.toString())} ${peer.name}=${JSON.stringify(peer.content.toString())}`,
      );
    }
  }
}

/** Deterministic PRNG (mulberry32) so every failing scenario can be replayed from its seed. */
export function createRandom(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (maxExclusive: number) => Math.floor(next() * maxExclusive),
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)] as T,
  };
}

/** The relay a client reconnects to: it only ever merges, never resolves conflicts itself. */
export function createServer(base?: Uint8Array): Peer {
  return createPeer('server', base);
}

/** Real reconnection handshake: the client gets what it misses and uploads what the server misses. */
export function reconnect(client: Peer, server: Peer) {
  deliver(server, client);
  deliver(client, server);
}

export function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, index) =>
    permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [item, ...rest]),
  );
}
