import { SYNC_LABELS as LABELS } from '../lib/note-navigation';
import type { SyncState } from '../lib/note-sync';

type NoteSyncStatusProps = {
  state: SyncState;
  retry: () => void;
  /** Whether the browser reports a network. Retry is pointless (and disabled) only without one. */
  networkOnline?: boolean;
};

/**
 * The single live region for synchronization. The dot is decorative: the state
 * is always in the text, never conveyed by colour alone.
 */
export default function NoteSyncStatus({ state, retry, networkOnline = true }: NoteSyncStatusProps) {
  const waitingForNetwork = state === 'offline' && !networkOnline;
  return (
    <div className="sync-status">
      <span className={`sync-dot sync-${state}`} aria-hidden="true" />
      <p role="status" aria-live="polite" aria-atomic="true">{LABELS[state]}</p>
      {state !== 'up-to-date' && <button type="button" className="retry" onClick={retry} disabled={waitingForNetwork}>Reintentar conexión</button>}
      {waitingForNetwork && <small>Se reanudará automáticamente al volver la red.</small>}
    </div>
  );
}
