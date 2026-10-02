import { createHash } from 'node:crypto';
import type { NoteId } from '@syncpad/shared';
import type { SqlExecutor } from './auth.js';

export interface SyncStore {
  load(noteId: NoteId): Promise<Uint8Array[]>;
  append(noteId: NoteId, update: Uint8Array): Promise<boolean>;
}

function hashUpdate(update: Uint8Array) {
  return createHash('sha256').update(update).digest('hex');
}

export function createPostgresSyncStore(database: SqlExecutor): SyncStore {
  return {
    async load(noteId) {
      const result = await database.query<{ update_data: Buffer }>(
        'SELECT update_data FROM syncpad.note_updates WHERE note_id = $1 ORDER BY created_at, id',
        [noteId],
      );
      return result.rows.map((row) => new Uint8Array(row.update_data));
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
  };
}