import type { WorkspaceId, WorkspaceSummary, UserId } from '@syncpad/shared';
import type { QueryResultRow } from 'pg';
import type { SqlExecutor } from './auth.js';

export type MembershipRole = 'OWNER' | 'MEMBER';

export type WorkspaceRecord = WorkspaceSummary & {
  createdBy: UserId;
};

export interface WorkspaceService {
  create(userId: UserId, name: string): Promise<WorkspaceRecord>;
  listForUser(userId: UserId): Promise<WorkspaceRecord[]>;
  getForUser(userId: UserId, workspaceId: WorkspaceId): Promise<WorkspaceRecord | null>;
}

export class WorkspaceNameError extends Error {
  constructor() {
    super('Workspace name must contain between 1 and 120 characters');
    this.name = 'WorkspaceNameError';
  }
}

function normalizeName(name: string) {
  const normalized = name.trim();
  if (normalized.length < 1 || normalized.length > 120) throw new WorkspaceNameError();
  return normalized;
}

function toWorkspace(row: { id: string; name: string; updated_at: string | Date; created_by: string }): WorkspaceRecord {
  return {
    id: row.id as WorkspaceId,
    name: row.name,
    updatedAt: new Date(row.updated_at).toISOString(),
    createdBy: row.created_by as UserId,
  };
}

export function createWorkspaceService(database: SqlExecutor): WorkspaceService {
  return {
    async create(userId: UserId, name: string): Promise<WorkspaceRecord> {
      const result = await database.query<{
        id: string;
        name: string;
        updated_at: string | Date;
        created_by: string;
      }>(
        `WITH workspace AS (
           INSERT INTO syncpad.workspaces (name, created_by)
           VALUES ($1, $2)
           RETURNING id, name, updated_at, created_by
         ), membership AS (
           INSERT INTO syncpad.memberships (workspace_id, user_id, role)
           SELECT id, $2, 'OWNER' FROM workspace
         )
         SELECT * FROM workspace`,
        [normalizeName(name), userId],
      );
      return toWorkspace(result.rows[0]);
    },

    async listForUser(userId: UserId): Promise<WorkspaceRecord[]> {
      const result = await database.query<{
        id: string;
        name: string;
        updated_at: string | Date;
        created_by: string;
      }>(
        `SELECT workspaces.id, workspaces.name, workspaces.updated_at, workspaces.created_by
         FROM syncpad.workspaces
         INNER JOIN syncpad.memberships ON memberships.workspace_id = workspaces.id
         WHERE memberships.user_id = $1
         ORDER BY workspaces.updated_at DESC, workspaces.id`,
        [userId],
      );
      return result.rows.map(toWorkspace);
    },

    async getForUser(userId: UserId, workspaceId: WorkspaceId): Promise<WorkspaceRecord | null> {
      const result = await database.query<{
        id: string;
        name: string;
        updated_at: string | Date;
        created_by: string;
      }>(
        `SELECT workspaces.id, workspaces.name, workspaces.updated_at, workspaces.created_by
         FROM syncpad.workspaces
         INNER JOIN syncpad.memberships ON memberships.workspace_id = workspaces.id
         WHERE memberships.user_id = $1 AND workspaces.id = $2`,
        [userId, workspaceId],
      );
      return result.rows[0] ? toWorkspace(result.rows[0]) : null;
    },
  };
}

export function isWorkspaceId(value: unknown): value is WorkspaceId {
  return typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value);
}

export type WorkspaceQueryRow = QueryResultRow;