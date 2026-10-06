import type { ClientSyncMessage, ServerSyncMessage } from '@syncpad/shared';
import { applyEditorUpdate, assertCompatibleUpdate, encodeEditorStateSince, encodeEditorStateVector, LOCAL_EDIT_ORIGIN, NoteSchemaError, REMOTE_ORIGIN, type EditorDocument } from './note-document';

export type SyncState = 'offline' | 'reconnecting' | 'syncing' | 'up-to-date';
export type NoteSyncHandle = { retry(): void; destroy(): void };
/** What an out-of-band check says about the note: still there, deleted/unreachable, or no answer. */
export type NoteProbe = 'present' | 'gone' | 'unknown';

type Timing = { initialDelayMs: number; maxDelayMs: number; deadlineMs: number };

export type NoteSyncOptions = {
  document: EditorDocument;
  url: string;
  onState(state: SyncState): void;
  /** True while local edits exist that the server has not acknowledged. */
  onPending?(pending: boolean): void;
  onError(message: string): void;
  /**
   * Called once when the note no longer exists on the server. Syncing stops for good and the
   * local document is left untouched so the caller can offer recovery.
   */
  onGone?(): void;
  /**
   * Called once when the server holds the note in a schema version this build cannot read (or
   * refuses ours). Syncing stops for good and nothing remote is ever applied: the local document
   * stays exactly as it was until the app is updated.
   */
  onIncompatible?(): void;
  /**
   * Asked after a connection attempt failed before opening, because a WebSocket upgrade
   * cannot tell "deleted" from "offline". Must resolve 'unknown' when it cannot decide.
   */
  probe?(): Promise<NoteProbe>;
  online?: () => boolean;
  events?: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
  socketFactory?: (url: string) => WebSocket;
  timing?: Partial<Timing>;
};

const DEFAULT_TIMING: Timing = { initialDelayMs: 500, maxDelayMs: 10_000, deadlineMs: 10_000 };
const SOCKET_OPEN = 1;
const NOTE_DELETED_CLOSE_CODE = 4404;

function toBase64(bytes: Uint8Array) {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

function fromBase64(value: string) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

/**
 * Keeps one Y.Doc reconciled with the server across transport failures.
 *
 * Every connection starts with a correlated state-vector handshake and then
 * uploads whatever the server is missing, so offline edits (including pure
 * deletions) and missed remote changes merge without duplication. Only the
 * matching ack of an upload counts as "saved on the server"; socket open or
 * send never does. The document and its local persistence are owned by the
 * caller and survive every reconnect and destroy().
 */
export function createNoteSync(options: NoteSyncOptions): NoteSyncHandle {
  const { document, url, onState, onPending, onError, onGone, onIncompatible, probe } = options;
  const timing = { ...DEFAULT_TIMING, ...options.timing };
  const online = options.online ?? (() => navigator.onLine);
  const events = options.events ?? window;
  const openSocket = options.socketFactory ?? ((target: string) => new WebSocket(target));

  let destroyed = false;
  let failed = false;
  let gone = false;
  let incompatible = false;
  let probing = false;
  let socket: WebSocket | null = null;
  let handshakeId: string | null = null;
  let baseVector: Uint8Array | null = null;
  let upload: { id: string; revision: number; vector: Uint8Array } | null = null;
  let reconciled = false;
  let localRevision = 0;
  let acknowledged = 0;
  let requestCounter = 0;
  let attempt = 0;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  let lastState: SyncState | undefined;
  let lastPending: boolean | undefined;

  const nextId = (kind: string) => `${kind}-${++requestCounter}`;
  const isOpen = () => socket !== null && socket.readyState === SOCKET_OPEN;

  function publish() {
    if (destroyed) return;
    let state: SyncState;
    if (failed || gone || incompatible) state = 'offline';
    else if (!isOpen()) state = online() ? 'reconnecting' : 'offline';
    else if (!reconciled || upload || localRevision !== acknowledged) state = 'syncing';
    else state = 'up-to-date';
    if (state !== lastState) { lastState = state; onState(state); }
    const pending = localRevision !== acknowledged;
    if (pending !== lastPending) { lastPending = pending; onPending?.(pending); }
  }

  function send(message: ClientSyncMessage) {
    socket?.send(JSON.stringify(message));
  }

  function clearDeadline() {
    clearTimeout(deadlineTimer);
    deadlineTimer = undefined;
  }

  function clearRetry() {
    clearTimeout(retryTimer);
    retryTimer = undefined;
  }

  function resetSession() {
    handshakeId = null;
    baseVector = null;
    upload = null;
    reconciled = false;
    clearDeadline();
  }

  /** Detaches the current socket; its late callbacks are ignored by identity. */
  function teardown() {
    const previous = socket;
    socket = null;
    resetSession();
    if (previous) {
      try { previous.close(); } catch { /* already closed */ }
    }
  }

  function scheduleReconnect() {
    if (destroyed || failed || gone || incompatible) return;
    publish();
    if (!online() || retryTimer !== undefined) return;
    const delay = Math.min(timing.maxDelayMs, timing.initialDelayMs * 2 ** attempt);
    attempt++;
    retryTimer = setTimeout(() => { retryTimer = undefined; connect(); }, delay);
  }

  function failTransport() {
    teardown();
    scheduleReconnect();
  }

  function markGone() {
    if (gone || destroyed) return;
    gone = true;
    teardown();
    clearRetry();
    publish();
    onGone?.();
  }

  function markIncompatible() {
    if (incompatible || gone || destroyed) return;
    incompatible = true;
    teardown();
    clearRetry();
    publish();
    onIncompatible?.();
  }

  /** Applies a remote update only if it keeps the schema readable; otherwise stops syncing for good. */
  function applyRemote(update: Uint8Array): boolean {
    try {
      assertCompatibleUpdate(document.doc, update);
    } catch (error) {
      if (!(error instanceof NoteSchemaError)) throw error;
      markIncompatible();
      return false;
    }
    applyEditorUpdate(document.doc, update, REMOTE_ORIGIN);
    return true;
  }

  function probeNote() {
    if (!probe || probing || gone || incompatible || destroyed || !online()) return;
    probing = true;
    void probe().then((result) => { if (result === 'gone') markGone(); }, () => {}).finally(() => { probing = false; });
  }

  function failPermanently(message: string) {
    teardown();
    clearRetry();
    failed = true;
    publish();
    onError(message);
  }

  function armDeadline() {
    clearDeadline();
    const watched = socket;
    deadlineTimer = setTimeout(() => {
      deadlineTimer = undefined;
      if (!destroyed && socket === watched) failTransport();
    }, timing.deadlineMs);
  }

  function sendUpload() {
    if (!isOpen() || !baseVector || upload) return;
    const id = nextId('up');
    // The vector and the diff are taken together so what is acked is exactly what was sent.
    upload = { id, revision: localRevision, vector: encodeEditorStateVector(document.doc) };
    send({ type: 'update', requestId: id, update: toBase64(encodeEditorStateSince(document.doc, baseVector)) });
    armDeadline();
  }

  function handleMessage(raw: string) {
    let message: ServerSyncMessage;
    try {
      message = JSON.parse(raw) as ServerSyncMessage;
    } catch {
      return;
    }
    switch (message.type) {
      case 'sync': {
        const correlated = message.requestId !== undefined && message.requestId === handshakeId;
        if (message.requestId !== undefined && !correlated) return;
        if (!applyRemote(fromBase64(message.update))) return;
        if (!correlated) { publish(); return; }
        handshakeId = null;
        baseVector = fromBase64(message.stateVector);
        // Reconciliation always uploads: after a reload nothing proves the server has our persisted state.
        sendUpload();
        publish();
        return;
      }
      case 'update':
        applyRemote(fromBase64(message.update));
        return;
      case 'ack': {
        if (!upload || message.requestId !== upload.id) return;
        acknowledged = Math.max(acknowledged, upload.revision);
        baseVector = upload.vector;
        upload = null;
        reconciled = true;
        attempt = 0;
        clearDeadline();
        if (localRevision !== acknowledged) sendUpload();
        publish();
        return;
      }
      case 'sync-error': {
        if (message.code === 'note-deleted') { markGone(); return; }
        if (message.code === 'incompatible-schema') { markIncompatible(); return; }
        if (message.requestId !== undefined && message.requestId !== handshakeId && message.requestId !== upload?.id) return;
        if (message.retryable) failTransport();
        else failPermanently('El servidor rechazó la sincronización. Tus cambios siguen guardados en este dispositivo.');
        return;
      }
    }
  }

  function connect() {
    if (destroyed || gone || incompatible) return;
    clearRetry();
    if (!online()) { publish(); return; }
    const connection = openSocket(url);
    let opened = false;
    socket = connection;
    const live = () => !destroyed && socket === connection;
    connection.onopen = () => {
      if (!live()) return;
      opened = true;
      handshakeId = nextId('sync');
      send({ type: 'sync-request', requestId: handshakeId, stateVector: toBase64(encodeEditorStateVector(document.doc)) });
      armDeadline();
      publish();
    };
    connection.onmessage = (event) => {
      if (live()) handleMessage(event.data as string);
    };
    connection.onclose = (event) => {
      if (!live()) return;
      socket = null;
      resetSession();
      if (event?.code === NOTE_DELETED_CLOSE_CODE) { markGone(); return; }
      scheduleReconnect();
      if (!opened) probeNote();
    };
    connection.onerror = () => { /* a close event always follows */ };
    publish();
  }

  const onDocumentUpdate = (_update: Uint8Array, origin: unknown) => {
    if (origin !== LOCAL_EDIT_ORIGIN) return;
    localRevision++;
    sendUpload();
    publish();
  };
  const onOnline = () => {
    if (destroyed) return;
    attempt = 0;
    if (!failed && !socket) connect(); else publish();
  };
  const onOffline = () => {
    if (destroyed) return;
    teardown();
    clearRetry();
    publish();
  };

  document.doc.on('update', onDocumentUpdate);
  events.addEventListener('online', onOnline);
  events.addEventListener('offline', onOffline);
  connect();

  return {
    retry() {
      if (destroyed || gone || incompatible) return;
      failed = false;
      attempt = 0;
      teardown();
      clearRetry();
      connect();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      clearRetry();
      clearDeadline();
      document.doc.off('update', onDocumentUpdate);
      events.removeEventListener('online', onOnline);
      events.removeEventListener('offline', onOffline);
      teardown();
    },
  };
}
