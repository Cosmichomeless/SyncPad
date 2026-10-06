/** Per-connection work limits that keep one misbehaving or flooded client from starving a room. */
export type SyncLimits = {
  /** How often every socket is pinged; one that never answered the previous ping is dropped. 0 disables. */
  heartbeatMs: number;
  /** Sustained messages per second one connection may send. */
  messagesPerSecond: number;
  /** Messages a connection may send in a burst before the sustained rate applies. */
  messageBurst: number;
};

export const DEFAULT_LIMITS: SyncLimits = {
  heartbeatMs: 30_000,
  // Typing is one upload per round trip, but selections stream presence; this is far above honest use.
  messagesPerSecond: 100,
  messageBurst: 200,
};

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
