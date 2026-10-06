import { createHash } from 'node:crypto';
import { applyNoteUpdate, createNoteDocument, encodeNoteState, type NoteId } from '@syncpad/shared';
import type { SqlExecutor } from './auth.js';

export interface SyncStore {
  /** The stored history of a note: its latest snapshot (if any) followed by every update after it. */
  load(noteId: NoteId): Promise<Uint8Array[]>;
  append(noteId: NoteId, update: Uint8Array): Promise<boolean>;
  /**
   * Folds the updates stored since the last snapshot into a new snapshot, but only once at least
   * `minUpdates` of them have piled up. Resolves true when a snapshot was written. Never changes
   * what `load` reconstructs. Optional: stores without it simply replay the whole history.
   */
  snapshot?(noteId: NoteId, minUpdates: number): Promise<boolean>;
  /**
   * Deletes the stored updates the latest snapshot already contains, except those younger than the
   * retention window. Resolves with how many rows were removed. Never changes what `load` rebuilds.
   */
  compact?(noteId: NoteId): Promise<number>;
}

/** Updates covered by a snapshot are kept this long so an old client's re-sent update stays a no-op. */
export const DEFAULT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** Reads `SYNC_RETENTION_HOURS` (a non-negative number of hours; 0 compacts right after each snapshot). */
export function loadRetentionMs(env: NodeJS.ProcessEnv) {
  const raw = env.SYNC_RETENTION_HOURS;
  if (raw === undefined) return DEFAULT_RETENTION_MS;
  if (!/^[0-9]+(\.[0-9]+)?$/.test(raw)) throw new Error('SYNC_RETENTION_HOURS must be a non-negative number of hours');
  return Math.round(Number(raw) * 60 * 60 * 1000);
}

function hashUpdate(update: Uint8Array) {
  return createHash('sha256').update(update).digest('hex');
}

export function createPostgresSyncStore(database: SqlExecutor, options: { retentionMs?: number } = {}): SyncStore {
  const retentionMs = options.retentionMs ?? DEFAULT_RETENTION_MS;
  async function latestSnapshot(noteId: NoteId) {
    const result = await database.query<{ covers_update_id: string; state: Buffer }>(
      'SELECT covers_update_id, state FROM syncpad.note_snapshots WHERE note_id = $1',
      [noteId],
    );
    const row = result.rows[0];
    // bigint arrives as a string; ids stay far below 2^53 so a number is exact.
    return row ? { coversUpdateId: Number(row.covers_update_id), state: new Uint8Array(row.state) } : null;
  }

  async function updatesAfter(noteId: NoteId, coversUpdateId: number) {
    const result = await database.query<{ id: string; update_data: Buffer }>(
      'SELECT id, update_data FROM syncpad.note_updates WHERE note_id = $1 AND id > $2 ORDER BY id',
      [noteId, coversUpdateId],
    );
    return result.rows.map((row) => ({ id: Number(row.id), data: new Uint8Array(row.update_data) }));
  }

  return {
    async load(noteId) {
      const base = await latestSnapshot(noteId);
      const updates = await updatesAfter(noteId, base?.coversUpdateId ?? 0);
      return [...(base ? [base.state] : []), ...updates.map((update) => update.data)];
    },

    async append(noteId, update) {
      const result = await database.query(
        `INSERT INTO syncpad.note_updates (note_id, update_hash, update_data)
         VALUES ($1, $2, $3)
         ON CONFLICT (note_id, update_hash) DO NOTHING`,
        [noteId, hashUpdate(update), Buffer.from(update)],
      );
      return result.rowCount === 1;
    },

    /**
     * The snapshot is built only from stored rows (previous snapshot + later updates), never from
     * a live room, so it is exactly the state `load` would have replayed. It assumes appends for a
     * note are serialized (one room per note, see the server queue): a lower id committing after a
     * higher one was read would be skipped by the cut.
     */
    async snapshot(noteId, minUpdates) {
      const base = await latestSnapshot(noteId);
      const updates = await updatesAfter(noteId, base?.coversUpdateId ?? 0);
      if (updates.length === 0 || updates.length < minUpdates) return false;
      const document = createNoteDocument();
      try {
        if (base) applyNoteUpdate(document.doc, base.state);
        for (const update of updates) applyNoteUpdate(document.doc, update.data);
        const state = encodeNoteState(document.doc);
        await database.query(
          `INSERT INTO syncpad.note_snapshots (note_id, covers_update_id, state, update_count)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (note_id) DO UPDATE
             SET covers_update_id = EXCLUDED.covers_update_id, state = EXCLUDED.state,
                 update_count = EXCLUDED.update_count, created_at = now()
             WHERE syncpad.note_snapshots.covers_update_id < EXCLUDED.covers_update_id`,
          [noteId, updates[updates.length - 1].id, Buffer.from(state), updates.length],
        );
        return true;
      } finally {
        document.doc.destroy();
      }
    },

    /**
     * The snapshot row is the only thing that licenses a delete: rows past its `covers_update_id`
     * are never touched, and with no snapshot the subquery is NULL so nothing matches. Rows inside
     * the retention window stay, which also keeps their hashes around to deduplicate re-sent updates.
     */
    async compact(noteId) {
      const result = await database.query(
        `DELETE FROM syncpad.note_updates
         WHERE note_id = $1
           AND id <= (SELECT covers_update_id FROM syncpad.note_snapshots WHERE note_id = $1)
           AND created_at < now() - ($2::bigint * interval '1 millisecond')`,
        [noteId, retentionMs],
      );
      return result.rowCount ?? 0;
    },
  };
}
