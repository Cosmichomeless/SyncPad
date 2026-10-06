import { createHash, randomBytes } from 'node:crypto';
import type { PendingInvitation, UserId, WorkspaceId, WorkspaceMember, WorkspaceRole, WorkspaceSummary } from '@syncpad/shared';
import type { QueryResultRow } from 'pg';
import type { SqlExecutor } from './auth.js';

export type MembershipRole = WorkspaceRole;

export type WorkspaceRecord = WorkspaceSummary & {
  role: MembershipRole;
  createdBy: UserId;
};

export interface WorkspaceService {
  create(userId: UserId, name: string): Promise<WorkspaceRecord>;
  listForUser(userId: UserId): Promise<WorkspaceRecord[]>;
  getForUser(userId: UserId, workspaceId: WorkspaceId): Promise<WorkspaceRecord | null>;
  invite(workspaceId: WorkspaceId, ownerId: UserId, email: string): Promise<{ workspaceId: WorkspaceId; email: string; token: string }>;
  acceptInvitation(token: string, userId: UserId, email: string): Promise<WorkspaceId>;
  removeMember(workspaceId: WorkspaceId, ownerId: UserId, memberId: UserId): Promise<void>;
  /** Everyone in the workspace, or null when the caller is not a member (indistinguishable from not found). */
  listMembers(workspaceId: WorkspaceId, userId: UserId): Promise<WorkspaceMember[] | null>;
  /** OWNER only. */
  listInvitations(workspaceId: WorkspaceId, ownerId: UserId): Promise<PendingInvitation[]>;
  /** OWNER only: withdraws a pending invitation so its link stops working. */
  revokeInvitation(workspaceId: WorkspaceId, ownerId: UserId, invitationId: string): Promise<void>;
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

/** The invitation cannot be created because of existing state; `code` lets the UI explain which. */
export class InvitationConflictError extends WorkspaceMembershipError {
  constructor(public readonly code: 'INVITATION_PENDING' | 'ALREADY_MEMBER', message: string) {
    super(message);
    this.name = 'InvitationConflictError';
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

function toWorkspace(row: { id: string; name: string; updated_at: string | Date; created_by: string; role: string }): WorkspaceRecord {
  return {
    role: row.role === 'OWNER' ? 'OWNER' : 'MEMBER',
    id: row.id as WorkspaceId,
    name: row.name,
    updatedAt: new Date(row.updated_at).toISOString(),
    createdBy: row.created_by as UserId,
  };
}

export function createWorkspaceService(database: SqlExecutor): WorkspaceService {
  async function requireOwner(workspaceId: WorkspaceId, userId: UserId, message: string) {
    const result = await database.query(
      `SELECT 1 FROM syncpad.memberships WHERE workspace_id = $1 AND user_id = $2 AND role = 'OWNER'`,
      [workspaceId, userId],
    );
    if (!result.rows[0]) throw new WorkspaceMembershipError(message);
  }

  return {
    async create(userId: UserId, name: string): Promise<WorkspaceRecord> {
      const result = await database.query<{
        id: string;
        name: string;
        updated_at: string | Date;
        created_by: string;
        role: string;
      }>(
        `WITH workspace AS (
           INSERT INTO syncpad.workspaces (name, created_by)
           VALUES ($1, $2)
           RETURNING id, name, updated_at, created_by
         ), membership AS (
           INSERT INTO syncpad.memberships (workspace_id, user_id, role)
           SELECT id, $2, 'OWNER' FROM workspace
         )
         SELECT workspace.*, 'OWNER'::text AS role FROM workspace`,
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
        role: string;
      }>(
        `SELECT workspaces.id, workspaces.name, workspaces.updated_at, workspaces.created_by, memberships.role
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
        role: string;
      }>(
        `SELECT workspaces.id, workspaces.name, workspaces.updated_at, workspaces.created_by, memberships.role
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
      // An expired pending invitation for the same email is replaced in place (new token, new expiry);
      // a still-valid one is left alone so its link cannot be silently invalidated.
      const result = await database.query<{ workspace_id: string }>(
        `WITH owner AS (
           SELECT workspace_id FROM syncpad.memberships
           WHERE workspace_id = $1 AND user_id = $2 AND role = 'OWNER'
         )
         INSERT INTO syncpad.invitations (workspace_id, invited_email, token_hash, invited_by)
         SELECT workspace_id, $3, $4, $2 FROM owner
         WHERE NOT EXISTS (
           SELECT 1 FROM syncpad.memberships existing
           INNER JOIN syncpad.users existing_user ON existing_user.id = existing.user_id
           WHERE existing.workspace_id = owner.workspace_id AND lower(existing_user.email) = $3
         )
         ON CONFLICT (workspace_id, lower(invited_email)) WHERE accepted_at IS NULL
         DO UPDATE SET token_hash = EXCLUDED.token_hash, invited_by = EXCLUDED.invited_by,
                       expires_at = now() + interval '7 days', created_at = now()
           WHERE syncpad.invitations.expires_at <= now()
         RETURNING workspace_id`,
        [workspaceId, ownerId, normalizedEmail, tokenHash(token)],
      );
      if (!result.rows[0]) {
        await requireOwner(workspaceId, ownerId, 'Only an OWNER can invite members');
        const member = await database.query(
          `SELECT 1 FROM syncpad.memberships existing
           INNER JOIN syncpad.users existing_user ON existing_user.id = existing.user_id
           WHERE existing.workspace_id = $1 AND lower(existing_user.email) = $2`,
          [workspaceId, normalizedEmail],
        );
        if (member.rows[0]) throw new InvitationConflictError('ALREADY_MEMBER', 'That person is already a member of this workspace');
        throw new InvitationConflictError('INVITATION_PENDING', 'An invitation for this email is already pending; revoke it to create a new link');
      }
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

    async listMembers(workspaceId: WorkspaceId, userId: UserId) {
      const result = await database.query<{ user_id: string; email: string; role: string; created_at: string | Date }>(
        `SELECT members.user_id, users.email, members.role, members.created_at
         FROM syncpad.memberships viewer
         INNER JOIN syncpad.memberships members ON members.workspace_id = viewer.workspace_id
         INNER JOIN syncpad.users users ON users.id = members.user_id
         WHERE viewer.workspace_id = $1 AND viewer.user_id = $2
         ORDER BY (members.role = 'OWNER') DESC, lower(users.email)`,
        [workspaceId, userId],
      );
      if (!result.rows.length) return null;
      return result.rows.map((row) => ({
        userId: row.user_id as UserId,
        email: row.email,
        role: row.role === 'OWNER' ? 'OWNER' : 'MEMBER',
        joinedAt: new Date(row.created_at).toISOString(),
      } satisfies WorkspaceMember));
    },

    async listInvitations(workspaceId: WorkspaceId, ownerId: UserId) {
      await requireOwner(workspaceId, ownerId, 'Only an OWNER can view invitations');
      const result = await database.query<{ id: string; invited_email: string; expires_at: string | Date }>(
        `SELECT id, invited_email, expires_at FROM syncpad.invitations
         WHERE workspace_id = $1 AND accepted_at IS NULL
         ORDER BY created_at DESC, id`,
        [workspaceId],
      );
      const now = Date.now();
      return result.rows.map((row) => {
        const expiresAt = new Date(row.expires_at);
        return { id: row.id, email: row.invited_email, expiresAt: expiresAt.toISOString(), expired: expiresAt.getTime() <= now } satisfies PendingInvitation;
      });
    },

    async revokeInvitation(workspaceId: WorkspaceId, ownerId: UserId, invitationId: string) {
      const result = await database.query(
        `DELETE FROM syncpad.invitations invitation
         USING syncpad.memberships actor
         WHERE invitation.id = $3 AND invitation.workspace_id = $1 AND invitation.accepted_at IS NULL
           AND actor.workspace_id = $1 AND actor.user_id = $2 AND actor.role = 'OWNER'
         RETURNING invitation.id`,
        [workspaceId, ownerId, invitationId],
      );
      if (!result.rows[0]) throw new WorkspaceMembershipError('Only an OWNER can revoke a pending invitation');
    },
  };
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function isWorkspaceId(value: unknown): value is WorkspaceId {
  return typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value);
}

export type WorkspaceQueryRow = QueryResultRow;