/** Work limits that keep one misbehaving or flooded client from starving a room or the process. */
export type SyncLimits = {
  /** How often every socket is pinged; one that never answered the previous ping is dropped. 0 disables. */
  heartbeatMs: number;
  /** Sustained messages per second one connection may send. */
  messagesPerSecond: number;
  /** Messages a connection may send in a burst before the sustained rate applies. */
  messageBurst: number;
  /** Presence messages per second one connection may send; the excess is dropped, the socket stays up. */
  awarenessPerSecond: number;
  /** Largest WebSocket message accepted, in bytes. Bigger frames close the connection (1009). */
  maxMessageBytes: number;
  /** Largest note, in characters. An update that would grow the note past it is rejected. */
  maxNoteChars: number;
  /** Most simultaneous connections to one note. */
  maxClientsPerRoom: number;
  /** How long a connection's session and note access are trusted before they are asked again. */
  permissionRecheckMs: number;
};

export const DEFAULT_LIMITS: SyncLimits = {
  heartbeatMs: 30_000,
  // Typing is one upload per round trip, but selections stream presence; this is far above honest use.
  messagesPerSecond: 100,
  messageBurst: 200,
  awarenessPerSecond: 20,
  maxMessageBytes: 1024 * 1024,
  maxNoteChars: 500_000,
  maxClientsPerRoom: 50,
  permissionRecheckMs: 5_000,
};

/** Which limit fired; logged so an operator can tell abuse from an undersized limit. */
export type LimitEvent =
  | { limit: 'rate'; noteId: string }
  | { limit: 'awareness-rate'; noteId: string }
  | { limit: 'note-size'; noteId: string; chars: number; max: number }
  | { limit: 'room-full'; noteId: string; max: number };

const ENV_LIMITS: Record<keyof SyncLimits, { env: string; min: number }> = {
  heartbeatMs: { env: 'SYNC_HEARTBEAT_MS', min: 0 },
  messagesPerSecond: { env: 'SYNC_MESSAGES_PER_SECOND', min: 1 },
  messageBurst: { env: 'SYNC_MESSAGE_BURST', min: 1 },
  awarenessPerSecond: { env: 'SYNC_AWARENESS_PER_SECOND', min: 1 },
  maxMessageBytes: { env: 'SYNC_MAX_MESSAGE_BYTES', min: 1024 },
  maxNoteChars: { env: 'SYNC_MAX_NOTE_CHARS', min: 1 },
  maxClientsPerRoom: { env: 'SYNC_MAX_CLIENTS_PER_ROOM', min: 1 },
  permissionRecheckMs: { env: 'SYNC_PERMISSION_RECHECK_MS', min: 1 },
};

/** Reads the limits from the environment; anything unset keeps its default and anything invalid fails startup. */
export function loadLimits(env: NodeJS.ProcessEnv): SyncLimits {
  const limits = { ...DEFAULT_LIMITS };
  for (const key of Object.keys(ENV_LIMITS) as (keyof SyncLimits)[]) {
    const { env: name, min } = ENV_LIMITS[key];
    const raw = env[name];
    if (raw === undefined || raw === '') continue;
    if (!/^[0-9]+$/.test(raw) || Number(raw) < min || !Number.isSafeInteger(Number(raw))) {
      throw new Error(`${name} must be an integer of at least ${min}`);
    }
    limits[key] = Number(raw);
  }
  return limits;
}

/** A token bucket: `take()` is true while the connection stays within its allowance. */
export function createRateLimiter(perSecond: number, burst: number, now: () => number = Date.now) {
  let tokens = burst;
  let last = now();
  return {
    take() {
      const current = now();
      tokens = Math.min(burst, tokens + ((current - last) / 1000) * perSecond);
      last = current;
      if (tokens < 1) return false;
      tokens -= 1;
      return true;
    },
  };
}
