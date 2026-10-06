'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { AwarenessUser, NoteSummary, WorkspaceSummary } from '@syncpad/shared';
import { applyLocalTextEdit, createEditorDocument, NoteSchemaError, redoLocalEdit, undoLocalEdit, type EditorDocument } from '../lib/note-document';
import { createNoteSync, type NoteSyncHandle, type SyncState } from '../lib/note-sync';
import NoteSyncStatus from './note-sync-status';
import { createDrainRegistry } from '../lib/note-drain';
import { noteStatusLabel } from '../lib/note-navigation';
import PresenceBar from './presence-bar';
import MembersPanel from './members-panel';
import RichPreview from './rich-preview';
import { encodeCursor, groupParticipants, remoteSelections, type Participant, type RemoteSelection } from '../lib/presence';
import { readBlocks, removeLink, setLink, toggleBold, toggleList, type Block } from '../lib/rich-text';
import { deleteLocalNote, persistNote } from '../lib/note-persistence';
import { HttpError, NetworkError, request, shouldHandleRequestFailure } from '../lib/api-request';
import { describeAcceptError, readInviteToken } from '../lib/invitations';
import { establishOfflineIdentity, invalidateOfflineIdentity, isCurrentIdentity, isOfflineIdentityLocked, readOfflineGeneration, readOfflineIdentity, subscribeOfflineIdentity, type OfflineIdentity } from '../lib/offline-session';
import { clearUserMetadata, discardOrphan, markVisited, readNotes, readOrphans, readVisitedNoteIds, readWorkspaces, removeWorkspace, retireNote, writeNotes, writeWorkspaces } from '../lib/offline-metadata';

const INVITE_STORAGE_KEY = 'syncpad.pendingInvite';
const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://127.0.0.1:3001/ws';

export default function Home() {
  const [user, setUser] = useState<{ id: string; email: string } | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [selectedWorkspace, setSelectedWorkspace] = useState<WorkspaceSummary | null>(null);
  const [selectedNote, updateSelectedNote] = useState<NoteSummary | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [noteTitle, setNoteTitle] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editorText, setEditorText] = useState('');
  const [editable, setEditable] = useState(false);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [formatError, setFormatError] = useState('');
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [selections, setSelections] = useState<RemoteSelection[]>([]);
  const [invite, setInvite] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState('');
  const [pending, setPending] = useState(false);
  const [syncError, setSyncError] = useState('');
  const [networkOnline, setNetworkOnline] = useState(true);
  const [syncState, setSyncState] = useState<SyncState>('offline');
  const [deleted, setDeleted] = useState(false);
  // 'remote': the server speaks a newer schema; 'local': the copy on this device was written by a newer editor.
  const [incompatible, setIncompatible] = useState<'remote' | 'local' | null>(null);
  const [orphans, setOrphans] = useState<NoteSummary[]>([]);
  // Notes left behind that are still uploading edits the server has not acknowledged yet.
  const [draining, setDraining] = useState<string[]>([]);
  const [drains] = useState(() => createDrainRegistry(setDraining));
  const deletedIdsRef = useRef(new Set<string>());
  const documentRef = useRef<EditorDocument | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const linkButtonRef = useRef<HTMLButtonElement | null>(null);
  /** Set when the person opens a note on purpose: focus moves to its editor once it can take it. */
  const focusEditorRef = useRef(false);
  const syncRef = useRef<NoteSyncHandle | null>(null);
  const awarenessRef = useRef<{ users: AwarenessUser[]; self: string | null }>({ users: [], self: null });
  const cursorTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const identityRef = useRef<OfflineIdentity | null>(null);
  const workspaceRef = useRef<WorkspaceSummary | null>(null);
  const noteRef = useRef<NoteSummary | null>(null);
  const navigationRef = useRef(0);
  const authRequestRef = useRef(0);
  const workspaceRequestRef = useRef(0);

  const setSelectedNote = useCallback((note: NoteSummary | null) => {
    noteRef.current = note;
    setEditorText('');
    setBlocks([]);
    awarenessRef.current = { users: [], self: null };
    setParticipants([]); setSelections([]);
    setLinkOpen(false); setLinkUrl(''); setFormatError('');
    setEditable(false);
    setPending(false);
    setSyncError('');
    setSyncState('offline');
    setDeleted(note ? deletedIdsRef.current.has(note.id) : false);
    setIncompatible(null);
    updateSelectedNote(note);
  }, []);

  const clearPrivateUI = useCallback(() => {
    identityRef.current = null; workspaceRef.current = null;
    navigationRef.current++; authRequestRef.current++; workspaceRequestRef.current++;
    syncRef.current?.destroy(); syncRef.current = null;
    documentRef.current = null;
    drains.clear();
    setUser(null); setWorkspaces([]); setNotes([]); setSelectedWorkspace(null); setSelectedNote(null);
    setWorkspaceName(''); setNoteTitle(''); setPassword(''); setEmail('');
  }, [setSelectedNote, drains]);

  const handleFailure = useCallback(async (cause: unknown, identity: OfflineIdentity, workspaceId?: string) => {
    if (!isCurrentIdentity(identity)) return;
    setError(cause instanceof Error ? cause.message : 'No se pudo completar la operación');
    if (cause instanceof HttpError && cause.status === 401) {
      invalidateOfflineIdentity(); clearPrivateUI();
      await clearUserMetadata(identity.user.id);
    } else if (cause instanceof HttpError && [403, 404].includes(cause.status)) {
      workspaceRequestRef.current++;
      if (workspaceId) {
        if (workspaceRef.current?.id === workspaceId) {
          navigationRef.current++;
          workspaceRef.current = null; setSelectedWorkspace(null); setNotes([]); setSelectedNote(null);
        }
        setWorkspaces(current => current.filter(row => row.id !== workspaceId));
        await removeWorkspace(identity.user.id, workspaceId);
      } else {
        navigationRef.current++;
        workspaceRef.current = null; setSelectedWorkspace(null); setWorkspaces([]); setNotes([]); setSelectedNote(null);
        await clearUserMetadata(identity.user.id);
      }
    }
  }, [clearPrivateUI, setSelectedNote]);

  const cacheFailure = useCallback((cause: unknown, identity: OfflineIdentity) => {
    if (!isCurrentIdentity(identity)) return;
    invalidateOfflineIdentity(); clearPrivateUI();
    setError(cause instanceof Error ? `Almacenamiento local: ${cause.message}. Vuelve a entrar para continuar.` : 'No se pudo guardar la navegación local. Vuelve a entrar para continuar.');
  }, [clearPrivateUI]);

  /**
   * The note no longer exists on the server. Stop syncing, keep the on-device copy open read-only
   * and remember it as recoverable; nothing here ever sends it back to the server.
   */
  const markNoteDeleted = useCallback(async (identity: OfflineIdentity, note: NoteSummary) => {
    if (!isCurrentIdentity(identity)) return;
    deletedIdsRef.current.add(note.id);
    syncRef.current?.destroy(); syncRef.current = null;
    setNotes(current => current.filter(row => row.id !== note.id));
    if (noteRef.current?.id === note.id) { setDeleted(true); setEditable(false); setSyncError(''); setSyncState('offline'); }
    await retireNote(identity, note).catch(cause => cacheFailure(cause, identity));
    if (!isCurrentIdentity(identity) || workspaceRef.current?.id !== note.workspaceId) return;
    setOrphans(await readOrphans(identity.user.id, note.workspaceId).catch(() => [] as NoteSummary[]));
  }, [cacheFailure]);

  const selectWorkspace = useCallback(async (workspace: WorkspaceSummary, preserve = false) => {
    const identity = identityRef.current;
    if (!identity || !isCurrentIdentity(identity)) return;
    const selection = ++navigationRef.current;
    workspaceRef.current = workspace; setSelectedWorkspace(workspace);
    if (!preserve) { setSelectedNote(null); setNotes([]); setOrphans([]); }
    try {
      let rows: NoteSummary[];
      try {
        rows = (await request<{ notes: NoteSummary[] }>(`/workspaces/${workspace.id}/notes`)).notes;
        if (!isCurrentIdentity(identity) || navigationRef.current !== selection) return;
        await writeNotes(identity, workspace.id, rows).catch(cause => cacheFailure(cause, identity));
      } catch (cause) {
        if (!(cause instanceof NetworkError)) throw cause;
        const cached = await readNotes(identity.user.id, workspace.id);
        const visited = await readVisitedNoteIds(identity.user.id);
        rows = (cached ?? []).filter(note => visited.includes(note.id));
      }
      if (!isCurrentIdentity(identity) || navigationRef.current !== selection) return;
      setNotes(rows);
      const recoverable = await readOrphans(identity.user.id, workspace.id).catch(() => [] as NoteSummary[]);
      if (!isCurrentIdentity(identity) || navigationRef.current !== selection) return;
      setOrphans(recoverable);
      const open = noteRef.current;
      if (open) {
        const selected = rows.find(row => row.id === open.id) ?? null;
        if (!selected) await markNoteDeleted(identity, open);
        else { noteRef.current = selected; updateSelectedNote(selected); }
      }
      return rows;
    } catch (cause) {
      if (isCurrentIdentity(identity) && shouldHandleRequestFailure(cause, navigationRef.current === selection))
        await handleFailure(cause, identity, workspace.id).catch(cause => cacheFailure(cause, identity));
    }
  }, [setSelectedNote, handleFailure, cacheFailure, markNoteDeleted]);

  const loadWorkspaceList = useCallback(async (identity: OfflineIdentity) => {
    const selection = navigationRef.current;
    const refresh = ++workspaceRequestRef.current;
    try {
      let rows: WorkspaceSummary[];
      try {
        rows = (await request<{ workspaces: WorkspaceSummary[] }>('/workspaces')).workspaces;
        if (!isCurrentIdentity(identity) || refresh !== workspaceRequestRef.current) return;
        await writeWorkspaces(identity, rows).catch(cause => cacheFailure(cause, identity));
      } catch (cause) {
        if (!(cause instanceof NetworkError)) throw cause;
        rows = await readWorkspaces(identity.user.id) ?? [];
      }
      if (!isCurrentIdentity(identity) || refresh !== workspaceRequestRef.current) return;
      setWorkspaces(rows);
      const previous = workspaceRef.current;
      if (previous && !rows.some(row => row.id === previous.id)) {
        navigationRef.current++;
        workspaceRef.current = null;
        setSelectedWorkspace(null); setNotes([]); setSelectedNote(null);
        return;
      }
      if (navigationRef.current !== selection) return;
      const workspace = previous ? rows.find(row => row.id === previous.id) : rows[0];
      if (workspace) await selectWorkspace(workspace, !!previous);
      else { workspaceRef.current = null; setSelectedWorkspace(null); setNotes([]); setSelectedNote(null); }
    } catch (cause) {
      if (isCurrentIdentity(identity) && shouldHandleRequestFailure(cause, refresh === workspaceRequestRef.current))
        await handleFailure(cause, identity).catch(cause => cacheFailure(cause, identity));
    }
  }, [selectWorkspace, setSelectedNote, handleFailure, cacheFailure]);

  useEffect(() => {
    let cancelled = false;
    const stop = subscribeOfflineIdentity(value => {
      if (identityRef.current && value?.generation !== identityRef.current.generation) clearPrivateUI();
    });
    const authenticate = async () => {
      if (isOfflineIdentityLocked()) return;
      const generation = readOfflineGeneration();
      const attempt = ++authRequestRef.current;
      let identity: OfflineIdentity | null;
      try {
        const result = await request<{ user: OfflineIdentity['user'] }>('/auth/me');
        if (cancelled || attempt !== authRequestRef.current || generation !== readOfflineGeneration() || isOfflineIdentityLocked()) return;
        const cached = readOfflineIdentity();
        if (identityRef.current && identityRef.current.user.id !== result.user.id) clearPrivateUI();
        identity = cached?.user.id === result.user.id ? cached : establishOfflineIdentity(result.user);
      } catch (cause) {
        if (cancelled || attempt !== authRequestRef.current || generation !== readOfflineGeneration()) return;
        if (cause instanceof HttpError && [401, 403].includes(cause.status)) {
          const old = readOfflineIdentity();
          invalidateOfflineIdentity(); clearPrivateUI();
          const lockedGeneration = readOfflineGeneration();
          if (old) await clearUserMetadata(old.user.id).catch(() => {
            if (lockedGeneration === readOfflineGeneration()) setError('Sesión bloqueada. No se pudo limpiar la navegación local.');
          });
          return;
        }
        if (!(cause instanceof NetworkError)) { setError(cause instanceof Error ? cause.message : 'No se pudo validar la sesión'); return; }
        identity = readOfflineIdentity();
      }
      if (cancelled || !identity || !isCurrentIdentity(identity)) return;
      identityRef.current = identity; setUser(identity.user);
      await loadWorkspaceList(identity);
    };
    void authenticate();
    const online = () => { void authenticate(); };
    window.addEventListener('online', online);
    return () => { cancelled = true; stop(); window.removeEventListener('online', online); };
  }, [loadWorkspaceList, clearPrivateUI]);

  // An invitation link is `/#invite=TOKEN`. The fragment is removed from the address bar at once and the
  // token kept only for this tab (sessionStorage) so signing in or registering first does not lose it.
  useEffect(() => {
    const capture = () => {
      let token = readInviteToken(window.location.hash);
      if (token) {
        try { window.sessionStorage.setItem(INVITE_STORAGE_KEY, token); } catch { /* storage unavailable */ }
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
      } else {
        try { token = readInviteToken(`#invite=${window.sessionStorage.getItem(INVITE_STORAGE_KEY) ?? ''}`); } catch { token = null; }
      }
      if (token) { setInvite(token); setInviteError(''); }
    };
    capture();
    // Pasting an invitation link into a tab that is already open only changes the fragment.
    window.addEventListener('hashchange', capture);
    return () => window.removeEventListener('hashchange', capture);
  }, []);

  function dismissInvite() {
    setInvite(null); setInviteError('');
    try { window.sessionStorage.removeItem(INVITE_STORAGE_KEY); } catch { /* storage unavailable */ }
  }

  async function acceptInvite() {
    const identity = identityRef.current;
    const token = invite;
    if (!identity || !token || !isCurrentIdentity(identity)) return;
    setBusy(true); setInviteError('');
    try {
      const { workspaceId } = await request<{ workspaceId: string }>(`/invitations/${token}/accept`, { method: 'POST' });
      if (!isCurrentIdentity(identity)) return;
      dismissInvite();
      try {
        const { workspace } = await request<{ workspace: WorkspaceSummary }>(`/workspaces/${workspaceId}`);
        if (isCurrentIdentity(identity)) await selectWorkspace(workspace);
      } catch { /* the list refresh below still shows the new workspace */ }
      if (isCurrentIdentity(identity)) await loadWorkspaceList(identity);
    } catch (cause) {
      if (isCurrentIdentity(identity)) setInviteError(describeAcceptError(cause));
    } finally { setBusy(false); }
  }

  async function submitAuth(mode: 'login' | 'register') {
    setBusy(true); setError('');
    const generation = readOfflineGeneration();
    const attempt = ++authRequestRef.current;
    try {
      const result = await request<{ user: { id: string; email: string } }>(`/auth/${mode}`, {
        method: 'POST', body: JSON.stringify({ email, password }),
      });
      if (attempt !== authRequestRef.current || generation !== readOfflineGeneration()) return;
      clearPrivateUI();
      const identity = establishOfflineIdentity(result.user);
      identityRef.current = identity;
      setUser(result.user); setPassword(''); await loadWorkspaceList(identity);
    } catch (cause) {
      if (attempt === authRequestRef.current && generation === readOfflineGeneration())
        setError(cause instanceof Error ? cause.message : 'No se pudo iniciar sesión');
    }
    finally { setBusy(false); }
  }

  async function createWorkspace() {
    const identity = identityRef.current;
    if (!identity || !isCurrentIdentity(identity)) return;
    const selection = navigationRef.current;
    setBusy(true); setError('');
    try {
      const result = await request<{ workspace: WorkspaceSummary }>('/workspaces', { method: 'POST', body: JSON.stringify({ name: workspaceName }) });
      if (!isCurrentIdentity(identity)) return;
      setWorkspaceName('');
      if (navigationRef.current === selection) await selectWorkspace(result.workspace);
      if (isCurrentIdentity(identity)) await loadWorkspaceList(identity);
    }
    catch (cause) { await handleFailure(cause, identity).catch(cause => cacheFailure(cause, identity)); }
    finally { setBusy(false); }
  }

  async function createNote() {
    const identity = identityRef.current;
    const workspace = workspaceRef.current;
    const selection = navigationRef.current;
    if (!identity || !workspace || !isCurrentIdentity(identity)) return;
    setBusy(true); setError('');
    try {
      const result = await request<{ note: NoteSummary }>(`/workspaces/${workspace.id}/notes`, { method: 'POST', body: JSON.stringify({ title: noteTitle }) });
      if (!isCurrentIdentity(identity) || navigationRef.current !== selection) return;
      setNoteTitle('');
      const rows = await selectWorkspace(workspace, true);
      if (!isCurrentIdentity(identity) || navigationRef.current !== selection + 1) return;
      const note = rows?.find(row => row.id === result.note.id);
      if (note) openNote(note);
    }
    catch (cause) {
      if (isCurrentIdentity(identity) && shouldHandleRequestFailure(cause, navigationRef.current === selection))
        await handleFailure(cause, identity, workspace.id).catch(cause => cacheFailure(cause, identity));
    }
    finally { setBusy(false); }
  }

  const userId = user?.id;
  const noteId = selectedNote?.id;
  const unsentIds = useMemo(() => new Set([...draining, ...(pending && noteId ? [noteId] : [])]), [draining, pending, noteId]);
  useEffect(() => {
    const identity = identityRef.current;
    const note = noteRef.current;
    if (!userId || !noteId || !identity || !note || !isCurrentIdentity(identity)) return;
    const document = createEditorDocument();
    let cancelled = false;
    let hydrated = false;
    const persistence = persistNote(userId, noteId, document.doc, () => {
      if (!cancelled && isCurrentIdentity(identity)) setError('No se pudo guardar en el almacenamiento local');
    });
    let sync: NoteSyncHandle | null = null;
    let unacknowledged = false;
    let released = false;
    let terminal = false;
    let settle: (() => void) | null = null;
    documentRef.current = document;
    const observeContent = () => {
      if (!hydrated || cancelled || !isCurrentIdentity(identity)) return;
      setEditorText(document.content.toString());
      setBlocks(readBlocks(document.content));
      const { users, self } = awarenessRef.current;
      if (users.length) setSelections(remoteSelections(document.content, users, self));
    };
    document.content.observe(observeContent);
    void persistence.whenSynced.then(async () => {
      if (cancelled || !isCurrentIdentity(identity)) return;
      await markVisited(identity, note).catch(cause => cacheFailure(cause, identity));
      if (cancelled || !isCurrentIdentity(identity)) return;
      hydrated = true;
      setEditorText(document.content.toString());
      setBlocks(readBlocks(document.content));
      // A deleted note is shown from its local copy only; it must never reconnect.
      if (deletedIdsRef.current.has(noteId)) return;
      setEditable(true);
      const current = () => !cancelled && isCurrentIdentity(identity);
      sync = createNoteSync({
        document,
        url: `${WS_URL}?noteId=${noteId}`,
        onState: (state) => { if (current()) setSyncState(state); },
        onPending: (value) => {
          unacknowledged = value;
          if (current()) setPending(value);
          else if (released && !value) settle?.();
        },
        onError: (message) => { terminal = true; if (current()) setSyncError(message); else if (released) settle?.(); },
        onGone: () => { terminal = true; if (current()) void markNoteDeleted(identity, note); else if (released) settle?.(); },
        onAwareness: (users, self) => {
          if (!current()) return;
          awarenessRef.current = { users, self };
          setParticipants(groupParticipants(users, self));
          setSelections(remoteSelections(document.content, users, self));
        },
        onIncompatible: () => { terminal = true; if (current()) { setIncompatible('remote'); setEditable(false); setSyncError(''); } else if (released) settle?.(); },
        probe: async () => {
          try {
            const { notes: listed } = await request<{ notes: NoteSummary[] }>(`/workspaces/${note.workspaceId}/notes`);
            return listed.some(row => row.id === noteId) ? 'present' : 'gone';
          } catch (cause) {
            return cause instanceof HttpError && [403, 404].includes(cause.status) ? 'gone' : 'unknown';
          }
        },
      });
      syncRef.current = sync;
    }).catch((cause) => {
      if (cancelled || !isCurrentIdentity(identity)) return;
      if (cause instanceof NoteSchemaError) setIncompatible('local');
      else setError('No se pudo abrir el almacenamiento local');
    });
    return () => {
      cancelled = true;
      clearTimeout(cursorTimerRef.current);
      document.content.unobserve(observeContent);
      if (syncRef.current === sync) syncRef.current = null;
      if (documentRef.current === document) documentRef.current = null;
      const finalize = () => {
        sync?.destroy();
        void persistence.destroy().then(
          () => document.doc.destroy(),
          () => document.doc.destroy(),
        );
      };
      // Leaving a note with edits the server has not acknowledged lets its session finish uploading.
      if (sync && unacknowledged && !terminal) {
        released = true;
        settle = drains.hold(noteId, finalize);
      } else {
        finalize();
      }
    };
  }, [userId, noteId, cacheFailure, markNoteDeleted, drains]);

  useEffect(() => {
    return () => drains.clear();
  }, [drains]);

  const activeTitle = selectedNote?.title;
  useEffect(() => {
    window.document.title = activeTitle ? `${activeTitle} · SyncPad` : 'SyncPad';
  }, [activeTitle]);

  useEffect(() => {
    const update = () => setNetworkOnline(navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);

  const retrySync = useCallback(() => {
    setSyncError('');
    syncRef.current?.retry();
  }, []);

  function openNote(note: NoteSummary) {
    focusEditorRef.current = true;
    setSelectedNote(note);
  }

  function openOrphan(note: NoteSummary) {
    deletedIdsRef.current.add(note.id);
    openNote(note);
  }

  useEffect(() => {
    if (!focusEditorRef.current || !(editable || deleted || incompatible)) return;
    const element = textareaRef.current;
    element?.focus();
    if (element && window.document.activeElement === element) focusEditorRef.current = false;
  }, [editable, deleted, incompatible, noteId]);

  function downloadLocalCopy() {
    const note = noteRef.current;
    if (!note) return;
    const url = URL.createObjectURL(new Blob([editorText], { type: 'text/plain;charset=utf-8' }));
    const link = window.document.createElement('a');
    link.href = url;
    link.download = `${note.title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').trim() || 'nota'}.txt`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function discardLocalCopy() {
    const identity = identityRef.current;
    const note = noteRef.current;
    if (!identity || !note || !isCurrentIdentity(identity)) return;
    setSelectedNote(null);
    try {
      await discardOrphan(identity.user.id, note);
      setOrphans(current => current.filter(row => row.id !== note.id));
      await deleteLocalNote(identity.user.id, note.id);
      deletedIdsRef.current.delete(note.id);
    } catch {
      if (isCurrentIdentity(identity)) setError('No se pudo descartar la copia local');
    }
  }

  function editContent(value: string) {
    const identity = identityRef.current;
    const document = documentRef.current;
    if (!identity || !isCurrentIdentity(identity) || !document) return;
    applyLocalTextEdit(document, value);
    setEditorText(document.content.toString());
  }

  /** Runs undo/redo on the CRDT history. Locked notes (read-only or disabled textarea) never reach it. */
  const stepHistory = useCallback((element: HTMLTextAreaElement, direction: 'undo' | 'redo') => {
    const document = documentRef.current;
    if (!document || element.readOnly || element.disabled) return;
    (direction === 'undo' ? undoLocalEdit : redoLocalEdit)(document);
    setEditorText(document.content.toString());
  }, []);

  /** Ctrl/Cmd+Z, Shift+Z and Ctrl+Y replace the textarea's own history, which would fight the controlled value. */
  function historyKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key !== 'z' && key !== 'y') return;
    event.preventDefault();
    stepHistory(event.currentTarget, key === 'y' || event.shiftKey ? 'redo' : 'undo');
  }

  // The menu entries Edit → Undo/Redo and mobile gestures arrive as native beforeinput events.
  const bindHistoryInput = useCallback((element: HTMLTextAreaElement | null) => {
    if (!element) return;
    textareaRef.current = element;
    const onBeforeInput = (event: InputEvent) => {
      if (event.inputType !== 'historyUndo' && event.inputType !== 'historyRedo') return;
      event.preventDefault();
      stepHistory(element, event.inputType === 'historyUndo' ? 'undo' : 'redo');
    };
    element.addEventListener('beforeinput', onBeforeInput);
    return () => { element.removeEventListener('beforeinput', onBeforeInput); if (textareaRef.current === element) textareaRef.current = null; };
  }, [stepHistory]);

  /** Shares the caret/selection with the room, at most a few times a second; blur clears it. */
  function shareCursor(element: HTMLTextAreaElement | null) {
    clearTimeout(cursorTimerRef.current);
    cursorTimerRef.current = setTimeout(() => {
      const document = documentRef.current;
      const sync = syncRef.current;
      if (!document || !sync) return;
      sync.setCursor(element ? encodeCursor(document.content, element.selectionStart, element.selectionEnd) : null);
    }, element ? 80 : 0);
  }

  /** Applies a mark to what is selected in the textarea; the CRDT change is synced like any other edit. */
  function formatSelection(apply: (document: EditorDocument, start: number, end: number) => boolean, emptyMessage = 'Selecciona primero el texto al que quieres dar formato.') {
    const document = documentRef.current;
    const element = textareaRef.current;
    if (!document || !element || element.readOnly || element.disabled) return false;
    const applied = apply(document, element.selectionStart, element.selectionEnd);
    setFormatError(applied ? '' : emptyMessage);
    return applied;
  }

  function submitLink() {
    const applied = formatSelection((document, start, end) => setLink(document, start, end, linkUrl), 'Escribe una dirección http(s):// o mailto: y selecciona el texto del enlace.');
    if (applied) { setLinkOpen(false); setLinkUrl(''); textareaRef.current?.focus(); }
  }

  /** Escape closes the link form and returns to the button that opened it. */
  function closeLink() {
    setLinkOpen(false);
    linkButtonRef.current?.focus();
  }

  async function logout() {
    invalidateOfflineIdentity(); clearPrivateUI(); setError('');
    const generation = readOfflineGeneration();
    try { await request('/auth/logout', { method: 'POST' }); }
    catch (cause) {
      if (generation === readOfflineGeneration()) setError(cause instanceof NetworkError
        ? 'Sesión local cerrada. Sin conexión no se pudo revocar la sesión del servidor; vuelve a entrar explícitamente para continuar.'
        : 'Sesión local cerrada. No se pudo revocar la sesión del servidor.');
    }
  }

  if (!user) return (
    <main id="principal" tabIndex={-1} className="shell auth-shell">
      <p className="eyebrow">SyncPad · acceso local</p>
      <h1>Tu espacio de notas.</h1>
      <p className="lead">Crea workspaces, guarda sus notas y prepara el terreno para la colaboración en tiempo real.</p>
      {invite && <p className="invite-banner" role="status">Has recibido una invitación a un workspace. Entra o crea una cuenta con el email al que se envió para aceptarla.</p>}
      <form className="panel auth-form" onSubmit={(event) => { event.preventDefault(); void submitAuth('login'); }}>
        <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
        <label>Contraseña<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} required /></label>
        <div className="actions"><button disabled={busy} type="submit">Entrar</button><button disabled={busy} type="button" onClick={() => void submitAuth('register')}>Crear cuenta</button></div>
        {error && <p className="error" role="alert">{error}</p>}
      </form>
    </main>
  );

  return (
    <main id="principal" tabIndex={-1} className="shell workspace-shell">
      <header className="topbar"><div><p className="eyebrow">Workspace privado</p><h1>SyncPad</h1></div><button className="quiet" onClick={() => void logout()}>Salir</button></header>
      <p className="welcome">{user.email}</p>
      {invite && <div className="invite-banner" role="region" aria-label="Invitación recibida"><p><strong>Has recibido una invitación a un workspace.</strong> Solo funciona con la cuenta del email invitado y se puede usar una vez.</p><div className="actions"><button type="button" disabled={busy} onClick={() => void acceptInvite()}>Aceptar invitación</button><button type="button" className="quiet" onClick={dismissInvite}>Descartar</button></div>{inviteError && <p className="error" role="alert">{inviteError}</p>}</div>}
      <section className="workspace-grid">
        <aside className="panel sidebar" aria-label="Workspaces"><h2>Workspaces</h2><div className="stack" role="group" aria-label="Lista de workspaces">{workspaces.map((workspace) => <button className={selectedWorkspace?.id === workspace.id ? 'list-item active' : 'list-item'} aria-current={selectedWorkspace?.id === workspace.id ? 'true' : undefined} key={workspace.id} onClick={() => void selectWorkspace(workspace)}>{workspace.name}</button>)}</div><form onSubmit={(event) => { event.preventDefault(); void createWorkspace(); }}><input aria-label="Nuevo workspace" placeholder="Nuevo workspace" value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} required /><button disabled={busy} type="submit">Crear</button></form>{selectedWorkspace && <MembersPanel key={selectedWorkspace.id} workspace={selectedWorkspace} currentUserId={user.id} />}</aside>
        <section className="panel notes-panel" aria-label="Notas"><div className="section-heading"><div><p className="eyebrow">{selectedWorkspace?.name ?? 'Workspace'}</p><h2>Notas</h2></div>{selectedWorkspace && <form className="inline-form" onSubmit={(event) => { event.preventDefault(); void createNote(); }}><input aria-label="Nueva nota" placeholder="Nueva nota" value={noteTitle} onChange={(event) => setNoteTitle(event.target.value)} required /><button disabled={busy} type="submit">Añadir</button></form>}</div>{!selectedWorkspace && <p className="empty">Crea un workspace para empezar.</p>}{selectedWorkspace && !notes.length && <p className="empty">Este workspace todavía no tiene notas.</p>}<div className="note-list" role="group" aria-label="Lista de notas">{notes.map((note) => <button className={selectedNote?.id === note.id ? 'note-card active' : 'note-card'} key={note.id} aria-current={selectedNote?.id === note.id ? 'true' : undefined} onClick={() => { if (selectedNote !== note) openNote(note); }}><strong>{note.title}</strong><small className={unsentIds.has(note.id) ? 'note-unsent' : undefined}>{noteStatusLabel({ active: selectedNote?.id === note.id, syncState, unsent: unsentIds.has(note.id), deleted: deleted && selectedNote?.id === note.id, fallback: `Actualizada ${new Date(note.updatedAt).toLocaleDateString('es-ES')}` })}</small></button>)}</div>{orphans.length > 0 && <div className="orphan-list" role="group" aria-label="Notas eliminadas en el servidor"><p className="eyebrow">Eliminadas en el servidor</p>{orphans.map((note) => <button className={selectedNote?.id === note.id ? 'note-card active' : 'note-card'} key={note.id} aria-current={selectedNote?.id === note.id ? 'true' : undefined} onClick={() => { if (selectedNote?.id !== note.id) openOrphan(note); }}><strong>{note.title}</strong><small>Copia local recuperable</small></button>)}</div>}{selectedNote && <article className="editor-preview"><div className="editor-heading"><div><p className="eyebrow">{deleted ? 'Eliminada' : 'Editando'}</p><h3 id="editor-title">{selectedNote.title}</h3></div>{!deleted && !incompatible && <NoteSyncStatus state={syncState} retry={retrySync} networkOnline={networkOnline} />}</div>{deleted && <div className="deleted-note" role="alert"><p><strong>Esta nota se eliminó en el servidor.</strong> Tu copia sigue en este dispositivo y ya no se sincroniza.{pending && ' Incluye cambios que nunca llegaron al servidor.'}</p><div className="actions"><button type="button" onClick={downloadLocalCopy}>Descargar copia (.txt)</button><button type="button" onClick={() => void discardLocalCopy()}>Descartar copia local</button></div></div>}{incompatible && <div className="incompatible-note" role="alert"><p><strong>Esta nota usa un formato más nuevo que esta versión de SyncPad.</strong> {incompatible === 'local' ? 'La copia de este dispositivo no se ha abierto ni modificado.' : 'Se ha dejado de sincronizar y no se ha aplicado nada del servidor.'} Recarga la aplicación para actualizarla; no se ha perdido nada.{incompatible === 'remote' && pending && ' Tus últimos cambios siguen guardados solo en este dispositivo.'}</p>{incompatible === 'remote' && <div className="actions"><button type="button" onClick={downloadLocalCopy}>Descargar copia (.txt)</button></div>}</div>}{!deleted && !incompatible && pending && <p className="pending">Cambios locales guardados en este dispositivo; pendientes de confirmar con el servidor.</p>}{syncError && <p className="error" role="alert">{syncError}</p>}{!deleted && !incompatible && <PresenceBar participants={participants} selections={selections} />}{!deleted && !incompatible && <div className="format-toolbar" role="toolbar" aria-label="Formato" onMouseDown={(event) => { if ((event.target as HTMLElement).tagName !== 'INPUT') event.preventDefault(); }}><button type="button" disabled={!editable} onClick={() => formatSelection(toggleBold)} aria-label="Negrita"><strong>N</strong></button><button type="button" disabled={!editable} onClick={() => formatSelection((document, start, end) => toggleList(document, start, end))} aria-label="Lista">• Lista</button><button type="button" ref={linkButtonRef} disabled={!editable} aria-expanded={linkOpen} aria-controls={linkOpen ? 'link-form' : undefined} onClick={() => setLinkOpen(open => !open)} aria-label="Enlace">Enlace</button><button type="button" disabled={!editable} onClick={() => formatSelection(removeLink)} aria-label="Quitar enlace">Quitar enlace</button></div>}{linkOpen && !deleted && !incompatible && <form id="link-form" className="link-form" onSubmit={(event) => { event.preventDefault(); submitLink(); }} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); closeLink(); } }}><input aria-label="Dirección del enlace" autoFocus type="url" placeholder="https://" value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} /><button type="submit">Aplicar enlace</button></form>}{formatError && <p className="format-hint" role="status">{formatError}</p>}<textarea aria-label="Contenido de la nota" aria-describedby="editor-title" disabled={!editable && !deleted && !incompatible} readOnly={deleted || incompatible !== null} value={editorText} onChange={(event) => editContent(event.target.value)} onKeyDown={historyKey} onSelect={(event) => shareCursor(event.currentTarget)} onBlur={() => shareCursor(null)} ref={bindHistoryInput} placeholder="Escribe el contenido de la nota..." />{editorText && <RichPreview blocks={blocks} />}</article>}{error && <p className="error" role="alert">{error}</p>}</section>
      </section>
    </main>
  );
}
