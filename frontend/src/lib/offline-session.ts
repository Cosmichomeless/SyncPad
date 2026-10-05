export type OfflineIdentity = { user: { id: string; email: string }; generation: string };
const KEY = 'syncpad.offline-identity.v1';
type RecordValue = OfflineIdentity | { generation: string; locked: true };
const listeners = new Set<(value: OfflineIdentity | null) => void>();
let memory: RecordValue | null = null;
let storageFailed = false;

function readRecord(): RecordValue | null {
  try {
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem(KEY);
    if (storageFailed) return memory;
    if (!raw) return null;
    const value = JSON.parse(raw);
    if (typeof value?.generation !== 'string') return { generation: '', locked: true };
    if (value.locked === true) return { generation: value.generation, locked: true };
    if (typeof value.user?.id !== 'string' || typeof value.user?.email !== 'string') return { generation: '', locked: true };
    return { user: { id: value.user.id, email: value.user.email }, generation: value.generation };
  } catch { return storageFailed ? memory : { generation: '', locked: true }; }
}
export function readOfflineGeneration(): string | null { return readRecord()?.generation ?? null; }
export function readOfflineIdentity(): OfflineIdentity | null {
  const record = readRecord();
  return record && 'user' in record ? record : null;
}
export function isOfflineIdentityLocked(): boolean {
  const record = readRecord();
  return !!record && 'locked' in record;
}
function publish() { for (const listener of listeners) listener(readOfflineIdentity()); }
function write(record: RecordValue) {
  memory = record;
  try { window.localStorage.setItem(KEY, JSON.stringify(record)); storageFailed = false; }
  catch { storageFailed = true; }
  publish();
}
export function establishOfflineIdentity(user: OfflineIdentity['user']): OfflineIdentity {
  const identity = { user: { id: user.id, email: user.email }, generation: crypto.randomUUID() };
  write(identity);
  return identity;
}
export function invalidateOfflineIdentity(): void { write({ generation: crypto.randomUUID(), locked: true }); }
export function isCurrentIdentity(identity: OfflineIdentity): boolean {
  const current = readOfflineIdentity();
  return current?.generation === identity.generation && current.user.id === identity.user.id;
}
function onStorage(event: StorageEvent) {
  if (event.key === KEY || event.key === null) { memory = null; storageFailed = false; publish(); }
}
export function subscribeOfflineIdentity(listener: (value: OfflineIdentity | null) => void): () => void {
  if (!listeners.size) window.addEventListener('storage', onStorage);
  listeners.add(listener);
  return () => { listeners.delete(listener); if (!listeners.size) window.removeEventListener('storage', onStorage); };
}
