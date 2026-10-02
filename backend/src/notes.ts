import type { NoteId, NoteSummary, UserId, WorkspaceId } from '@syncpad/shared';
import type { SqlExecutor } from './auth.js';

export type NoteRecord = NoteSummary & {
    createdBy: UserId;
};

export interface NoteService {
    create(userId: UserId, workspaceId: WorkspaceId, title: string): Promise<NoteRecord | null>;
    listForUser(userId: UserId, workspaceId: WorkspaceId): Promise<NoteRecord[] | null>;
    rename(userId: UserId, noteId: NoteId, title: string): Promise<NoteRecord | null>;
    delete(userId: UserId, noteId: NoteId): Promise<boolean>;
    canAccess(userId: UserId, noteId: NoteId): Promise<boolean>;
}

export class NoteTitleError extends Error {
    constructor() {
        super('Note title must contain between 1 and 200 characters');
        this.name = 'NoteTitleError';
    }
}

function normalizeTitle(title: string) {
    const normalized = title.trim();
    if (normalized.length < 1 || normalized.length > 200) throw new NoteTitleError();
    return normalized;
}

function toNote(row: { id: string; workspace_id: string; title: string; created_by: string; updated_at: string | Date }): NoteRecord {
    return {
        id: row.id as NoteId,
        workspaceId: row.workspace_id as WorkspaceId,
        title: row.title,
        updatedAt: new Date(row.updated_at).toISOString(),
        createdBy: row.created_by as UserId,
    };
}

export function createNoteService(database: SqlExecutor): NoteService {
    return {
        async create(userId: UserId, workspaceId: WorkspaceId, title: string) {
            const result = await database.query<{
                id: string;
                workspace_id: string;
                title: string;
                created_by: string;
                updated_at: string | Date;
            }>(
                `INSERT INTO syncpad.notes (workspace_id, title, created_by)
         SELECT $1, $3, $2
         WHERE EXISTS (
           SELECT 1 FROM syncpad.memberships
           WHERE workspace_id = $1 AND user_id = $2
         )
         RETURNING id, workspace_id, title, created_by, updated_at`,
                [workspaceId, userId, normalizeTitle(title)],
            );
            if (!result.rows[0]) return null;
            return toNote(result.rows[0]);
        },

        async listForUser(userId: UserId, workspaceId: WorkspaceId) {
            const membership = await database.query(
                'SELECT 1 FROM syncpad.memberships WHERE user_id = $1 AND workspace_id = $2',
                [userId, workspaceId],
            );
            if (!membership.rows[0]) return null;
            const result = await database.query<{
                id: string;
                workspace_id: string;
                title: string;
                created_by: string;
                updated_at: string | Date;
            }>(
                `SELECT notes.id, notes.workspace_id, notes.title, notes.created_by, notes.updated_at
         FROM syncpad.notes
         INNER JOIN syncpad.memberships
           ON memberships.workspace_id = notes.workspace_id
          AND memberships.user_id = $1
         WHERE notes.workspace_id = $2
         ORDER BY notes.updated_at DESC, notes.id`,
                [userId, workspaceId],
            );
            return result.rows.map(toNote);
        },

        async rename(userId: UserId, noteId: NoteId, title: string) {
            const result = await database.query<{
                id: string;
                workspace_id: string;
                title: string;
                created_by: string;
                updated_at: string | Date;
            }>(
                `UPDATE syncpad.notes
         SET title = $2, updated_at = now()
         WHERE id = $1
           AND EXISTS (
             SELECT 1 FROM syncpad.memberships
             WHERE workspace_id = notes.workspace_id AND user_id = $3
           )
         RETURNING id, workspace_id, title, created_by, updated_at`,
                [noteId, normalizeTitle(title), userId],
            );
            return result.rows[0] ? toNote(result.rows[0]) : null;
        },

        async delete(userId: UserId, noteId: NoteId) {
            const result = await database.query(
                `DELETE FROM syncpad.notes
         WHERE id = $1
           AND EXISTS (
             SELECT 1 FROM syncpad.memberships
             WHERE workspace_id = notes.workspace_id AND user_id = $2
           )
         RETURNING id`,
                [noteId, userId],
            );
            return Boolean(result.rows[0]);
        },

        async canAccess(userId: UserId, noteId: NoteId) {
            const result = await database.query(
                `SELECT 1 FROM syncpad.notes
                 INNER JOIN syncpad.memberships
                     ON memberships.workspace_id = notes.workspace_id
                    AND memberships.user_id = $2
                 WHERE notes.id = $1`,
                [noteId, userId],
            );
            return Boolean(result.rows[0]);
        },
    };
}

export function isNoteId(value: unknown): value is NoteId {
    return typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value);
}