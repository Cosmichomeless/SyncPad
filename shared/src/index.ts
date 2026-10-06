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

export type WorkspaceSummary = {
  id: WorkspaceId;
  name: string;
  updatedAt: string;
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
  | { type: 'awareness' };

export type SyncErrorCode = 'persistence-unavailable' | 'invalid-message';

/** Messages the server sends. `ack` is emitted only after the update is durably appended. */
export type ServerSyncMessage =
  | { type: 'sync'; requestId?: string; update: string; stateVector: string }
  | { type: 'update'; update: string }
  | { type: 'ack'; requestId: string }
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
  NOTE_CONTENT_NAME,
  NOTE_ROOT_NAME,
} from './document.js';
export type { NoteDocument } from './document.js';