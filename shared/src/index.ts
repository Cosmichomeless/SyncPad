export const SYNC_PROTOCOL_VERSION = 1 as const;

export type EntityId = string & { readonly __entityId: unique symbol };
export type UserId = EntityId & { readonly __userId: unique symbol };
export type WorkspaceId = EntityId & { readonly __workspaceId: unique symbol };
export type NoteId = EntityId & { readonly __noteId: unique symbol };

export type HealthResponse = {
  status: 'ok';
};

export type ApiErrorResponse = {
  error: {
    code: string;
    message: string;
  };
};

export type AuthUserResponse = {
  user: {
    id: UserId;
    email: string;
  };
};

export type WorkspaceRole = 'OWNER' | 'MEMBER';

export type WorkspaceSummary = {
  id: WorkspaceId;
  name: string;
  updatedAt: string;
  /** The caller's role. Absent in copies cached before roles existed: treat that as MEMBER. */
  role?: WorkspaceRole;
};

export type WorkspaceMember = {
  userId: UserId;
  email: string;
  role: WorkspaceRole;
  joinedAt: string;
};

/** A not-yet-accepted invitation. The token itself is never stored or listed: it is shown once, at creation. */
export type PendingInvitation = {
  id: string;
  email: string;
  expiresAt: string;
  expired: boolean;
};

export type NoteSummary = {
  id: NoteId;
  workspaceId: WorkspaceId;
  title: string;
  updatedAt: string;
};

export type SyncHandshake = {
  protocolVersion: typeof SYNC_PROTOCOL_VERSION;
  workspaceId: WorkspaceId;
  noteId: NoteId;
};

/** Messages a client may send. `requestId` is optional so legacy clients keep working. */
export type ClientSyncMessage =
  | { type: 'sync-request'; requestId?: string; stateVector?: string }
  | { type: 'update'; requestId?: string; update: string }
  | { type: 'awareness'; cursor?: AwarenessCursor | null };

/**
 * An ephemeral selection, as two base64 Yjs relative positions so it follows the text while
 * others edit. Never written to the document or to storage.
 */
export type AwarenessCursor = { anchor: string; head: string };

/** One live connection in a note's room. The same user in two tabs appears twice. */
export type AwarenessUser = {
  connectionId: string;
  userId: string;
  email: string;
  cursor?: AwarenessCursor | null;
};

/**
 * `note-deleted` is final: the note no longer exists on the server and must not be recreated by a client.
 * `incompatible-schema` is final for this build: the note uses a document schema version it cannot
 * read, so the client must stop syncing and keep its local copy untouched until it is updated.
 */
export type SyncErrorCode = 'persistence-unavailable' | 'invalid-message' | 'note-deleted' | 'incompatible-schema' | 'rate-limited' | 'note-too-large' | 'room-full' | 'access-revoked';

/** Messages the server sends. `ack` is emitted only after the update is durably appended. */
export type ServerSyncMessage =
  | { type: 'sync'; requestId?: string; update: string; stateVector: string }
  | { type: 'update'; update: string }
  | { type: 'ack'; requestId: string }
  | { type: 'awareness'; users: AwarenessUser[]; self: string }
  | { type: 'sync-error'; requestId?: string; code: SyncErrorCode; retryable: boolean };

export {
  applyNoteUpdate,
  assertNoteDocument,
  assertValidNoteUpdate,
  createNoteDocument,
  DOCUMENT_SCHEMA_VERSION,
  encodeNoteState,
  encodeNoteStateSince,
  encodeNoteStateVector,
  isNoteSchemaError,
  NOTE_CONTENT_NAME,
  NOTE_ROOT_NAME,
  NoteSchemaError,
  readSchemaVersion,
} from './document.js';
export type { NoteDocument } from './document.js';