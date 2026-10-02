import { createHash, randomBytes } from 'node:crypto';
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
  invite(workspaceId: WorkspaceId, ownerId: UserId, email: string): Promise<{ workspaceId: WorkspaceId; email: string; token: string }>;
  acceptInvitation(token: string, userId: UserId, email: string): Promise<WorkspaceId>;
  removeMember(workspaceId: WorkspaceId, ownerId: UserId, memberId: UserId): Promise<void>;
}

export class WorkspaceNameError extends Error {
  constructor() {
    super('Workspace name must contain between 1 and 120 characters');
    this.name = 'WorkspaceNameError';
  }
}

export class WorkspaceMembershipError extends Error {
  constructor(message = 'Workspace membership operation is not allowed') {
    super(message);
    this.name = 'WorkspaceMembershipError';
  }
}

function normalizeEmail(email: string) {
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new WorkspaceMembershipError('A valid email is required');
  return normalized;
}

function tokenHash(token: string) {
  return createHash('sha256').update(token).digest('base64url');
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

    async invite(workspaceId: WorkspaceId, ownerId: UserId, email: string) {
      const normalizedEmail = normalizeEmail(email);
      const token = randomBytes(32).toString('base64url');
      const result = await database.query<{ workspace_id: string }>(
        `WITH owner AS (
           SELECT workspace_id FROM syncpad.memberships
           WHERE workspace_id = $1 AND user_id = $2 AND role = 'OWNER'
         )
         INSERT INTO syncpad.invitations (workspace_id, invited_email, token_hash, invited_by)
         SELECT workspace_id, $3, $4, $2 FROM owner
         RETURNING workspace_id`,
        [workspaceId, ownerId, normalizedEmail, tokenHash(token)],
      );
      if (!result.rows[0]) throw new WorkspaceMembershipError('Only an OWNER can invite members');
      return { workspaceId: result.rows[0].workspace_id as WorkspaceId, email: normalizedEmail, token };
    },

    async acceptInvitation(token: string, userId: UserId, email: string) {
      const result = await database.query<{ workspace_id: string }>(
        `WITH claimed AS (
           UPDATE syncpad.invitations
           SET accepted_at = now(), accepted_by = $2
           WHERE token_hash = $1
             AND accepted_at IS NULL
             AND expires_at > now()
             AND lower(invited_email) = $3
           RETURNING workspace_id
         ), membership AS (
           INSERT INTO syncpad.memberships (workspace_id, user_id, role)
           SELECT workspace_id, $2, 'MEMBER' FROM claimed
           ON CONFLICT (workspace_id, user_id) DO NOTHING
         )
         SELECT workspace_id FROM claimed`,
        [tokenHash(token), userId, normalizeEmail(email)],
      );
      if (!result.rows[0]) throw new WorkspaceMembershipError('Invitation is invalid, expired or already used');
      return result.rows[0].workspace_id as WorkspaceId;
    },

    async removeMember(workspaceId: WorkspaceId, ownerId: UserId, memberId: UserId) {
      const result = await database.query(
        `DELETE FROM syncpad.memberships target
         USING syncpad.memberships actor
         WHERE target.workspace_id = $1
           AND actor.workspace_id = $1
           AND actor.user_id = $2
           AND actor.role = 'OWNER'
           AND target.user_id = $3
           AND (target.role = 'MEMBER' OR (
             SELECT count(*) FROM syncpad.memberships owners
             WHERE owners.workspace_id = $1 AND owners.role = 'OWNER'
           ) > 1)
         RETURNING target.user_id`,
        [workspaceId, ownerId, memberId],
      );
      if (!result.rows[0]) throw new WorkspaceMembershipError('Only an OWNER can remove this member');
    },
  };
}

export function isWorkspaceId(value: unknown): value is WorkspaceId {
  return typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value);
}

export type WorkspaceQueryRow = QueryResultRow;