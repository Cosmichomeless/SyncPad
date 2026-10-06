import type { SyncState } from './note-sync';

export const SYNC_LABELS: Record<SyncState, string> = {
  offline: 'Sin conexión',
  reconnecting: 'Reconectando',
  syncing: 'Sincronizando',
  'up-to-date': 'Al día',
};

export type NoteStatusInput = {
  active: boolean;
  syncState: SyncState;
  /** The note has edits the server has not acknowledged (active session or background upload). */
  unsent: boolean;
  deleted?: boolean;
  /** Shown for notes with nothing to report. */
  fallback: string;
};

/** The one-line status under a note in the list, so the active note and unsent edits are never ambiguous. */
export function noteStatusLabel({ active, syncState, unsent, deleted, fallback }: NoteStatusInput): string {
  if (deleted) return 'Eliminada en el servidor';
  if (active) return unsent && syncState !== 'syncing' ? `${SYNC_LABELS[syncState]} · cambios sin enviar` : SYNC_LABELS[syncState];
  return unsent ? 'Cambios sin enviar' : fallback;
}
