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