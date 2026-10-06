'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { NoteSummary, WorkspaceSummary } from '@syncpad/shared';
import { applyLocalTextEdit, createEditorDocument, type EditorDocument } from '../lib/note-document';
import { createNoteSync, type NoteSyncHandle, type SyncState } from '../lib/note-sync';
import NoteSyncStatus from './note-sync-status';
import { persistNote } from '../lib/note-persistence';
import { HttpError, NetworkError, request, shouldHandleRequestFailure } from '../lib/api-request';
import { establishOfflineIdentity, invalidateOfflineIdentity, isCurrentIdentity, isOfflineIdentityLocked, readOfflineGeneration, readOfflineIdentity, subscribeOfflineIdentity, type OfflineIdentity } from '../lib/offline-session';
import { clearUserMetadata, markVisited, readNotes, readVisitedNoteIds, readWorkspaces, removeWorkspace, writeNotes, writeWorkspaces } from '../lib/offline-metadata';

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
  const [pending, setPending] = useState(false);
  const [syncError, setSyncError] = useState('');
  const [networkOnline, setNetworkOnline] = useState(true);
  const [syncState, setSyncState] = useState<SyncState>('offline');
  const documentRef = useRef<EditorDocument | null>(null);
  const syncRef = useRef<NoteSyncHandle | null>(null);
  const identityRef = useRef<OfflineIdentity | null>(null);
  const workspaceRef = useRef<WorkspaceSummary | null>(null);
  const noteRef = useRef<NoteSummary | null>(null);
  const navigationRef = useRef(0);
  const authRequestRef = useRef(0);
  const workspaceRequestRef = useRef(0);

  const setSelectedNote = useCallback((note: NoteSummary | null) => {
    noteRef.current = note;
    setEditorText('');
    setEditable(false);
    setPending(false);
    setSyncError('');
    setSyncState('offline');
    updateSelectedNote(note);
  }, []);

  const clearPrivateUI = useCallback(() => {
    identityRef.current = null; workspaceRef.current = null;
    navigationRef.current++; authRequestRef.current++; workspaceRequestRef.current++;
    syncRef.current?.destroy(); syncRef.current = null;
    documentRef.current = null;
    setUser(null); setWorkspaces([]); setNotes([]); setSelectedWorkspace(null); setSelectedNote(null);
    setWorkspaceName(''); setNoteTitle(''); setPassword(''); setEmail('');
  }, [setSelectedNote]);

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

  const selectWorkspace = useCallback(async (workspace: WorkspaceSummary, preserve = false) => {
    const identity = identityRef.current;
    if (!identity || !isCurrentIdentity(identity)) return;
    const selection = ++navigationRef.current;
    workspaceRef.current = workspace; setSelectedWorkspace(workspace);
    if (!preserve) { setSelectedNote(null); setNotes([]); }
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
      if (noteRef.current) {
        const selected = rows.find(row => row.id === noteRef.current?.id) ?? null;
        if (!selected) setSelectedNote(null);
        else { noteRef.current = selected; updateSelectedNote(selected); }
      }
      return rows;
    } catch (cause) {
      if (isCurrentIdentity(identity) && shouldHandleRequestFailure(cause, navigationRef.current === selection))
        await handleFailure(cause, identity, workspace.id).catch(cause => cacheFailure(cause, identity));
    }
  }, [setSelectedNote, handleFailure, cacheFailure]);

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
      if (note) setSelectedNote(note);
    }
    catch (cause) {
      if (isCurrentIdentity(identity) && shouldHandleRequestFailure(cause, navigationRef.current === selection))
        await handleFailure(cause, identity, workspace.id).catch(cause => cacheFailure(cause, identity));
    }
    finally { setBusy(false); }
  }

  const userId = user?.id;
  const noteId = selectedNote?.id;
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
    documentRef.current = document;
    const observeContent = () => {
      if (hydrated && !cancelled && isCurrentIdentity(identity)) setEditorText(document.content.toString());
    };
    document.content.observe(observeContent);
    void persistence.whenSynced.then(async () => {
      if (cancelled || !isCurrentIdentity(identity)) return;
      await markVisited(identity, note).catch(cause => cacheFailure(cause, identity));
      if (cancelled || !isCurrentIdentity(identity)) return;
      hydrated = true;
      setEditorText(document.content.toString());
      setEditable(true);
      const current = () => !cancelled && isCurrentIdentity(identity);
      sync = createNoteSync({
        document,
        url: `${WS_URL}?noteId=${noteId}`,
        onState: (state) => { if (current()) setSyncState(state); },
        onPending: (value) => { if (current()) setPending(value); },
        onError: (message) => { if (current()) setSyncError(message); },
      });
      syncRef.current = sync;
    }).catch(() => {
      if (!cancelled && isCurrentIdentity(identity)) setError('No se pudo abrir el almacenamiento local');
    });
    return () => {
      cancelled = true;
      document.content.unobserve(observeContent);
      sync?.destroy();
      if (syncRef.current === sync) syncRef.current = null;
      if (documentRef.current === document) documentRef.current = null;
      void persistence.destroy().then(
        () => document.doc.destroy(),
        () => document.doc.destroy(),
      );
    };
  }, [userId, noteId, cacheFailure]);

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

  function editContent(value: string) {
    const identity = identityRef.current;
    const document = documentRef.current;
    if (!identity || !isCurrentIdentity(identity) || !document) return;
    applyLocalTextEdit(document, value);
    setEditorText(document.content.toString());
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
    <main className="shell auth-shell">
      <p className="eyebrow">SyncPad · acceso local</p>
      <h1>Tu espacio de notas.</h1>
      <p className="lead">Crea workspaces, guarda sus notas y prepara el terreno para la colaboración en tiempo real.</p>
      <form className="panel auth-form" onSubmit={(event) => { event.preventDefault(); void submitAuth('login'); }}>
        <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
        <label>Contraseña<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} required /></label>
        <div className="actions"><button disabled={busy} type="submit">Entrar</button><button disabled={busy} type="button" onClick={() => void submitAuth('register')}>Crear cuenta</button></div>
        {error && <p className="error" role="alert">{error}</p>}
      </form>
    </main>
  );

  return (
    <main className="shell workspace-shell">
      <header className="topbar"><div><p className="eyebrow">Workspace privado</p><h1>SyncPad</h1></div><button className="quiet" onClick={() => void logout()}>Salir</button></header>
      <p className="welcome">{user.email}</p>
      <section className="workspace-grid">
        <aside className="panel sidebar"><h2>Workspaces</h2><div className="stack">{workspaces.map((workspace) => <button className={selectedWorkspace?.id === workspace.id ? 'list-item active' : 'list-item'} key={workspace.id} onClick={() => void selectWorkspace(workspace)}>{workspace.name}</button>)}</div><form onSubmit={(event) => { event.preventDefault(); void createWorkspace(); }}><input aria-label="Nuevo workspace" placeholder="Nuevo workspace" value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} required /><button disabled={busy} type="submit">Crear</button></form></aside>
        <section className="panel notes-panel"><div className="section-heading"><div><p className="eyebrow">{selectedWorkspace?.name ?? 'Workspace'}</p><h2>Notas</h2></div>{selectedWorkspace && <form className="inline-form" onSubmit={(event) => { event.preventDefault(); void createNote(); }}><input aria-label="Nueva nota" placeholder="Nueva nota" value={noteTitle} onChange={(event) => setNoteTitle(event.target.value)} required /><button disabled={busy} type="submit">Añadir</button></form>}</div>{!selectedWorkspace && <p className="empty">Crea un workspace para empezar.</p>}{selectedWorkspace && !notes.length && <p className="empty">Este workspace todavía no tiene notas.</p>}<div className="note-list">{notes.map((note) => <button className={selectedNote?.id === note.id ? 'note-card active' : 'note-card'} key={note.id} onClick={() => { if (selectedNote !== note) setSelectedNote(note); }}><strong>{note.title}</strong><small>Actualizada {new Date(note.updatedAt).toLocaleDateString('es-ES')}</small></button>)}</div>{selectedNote && <article className="editor-preview"><div className="editor-heading"><div><p className="eyebrow">Editando</p><h3>{selectedNote.title}</h3></div><NoteSyncStatus state={syncState} retry={retrySync} networkOnline={networkOnline} /></div>{pending && <p className="pending">Cambios locales guardados en este dispositivo; pendientes de confirmar con el servidor.</p>}{syncError && <p className="error" role="alert">{syncError}</p>}<textarea aria-label="Contenido de la nota" disabled={!editable} value={editorText} onChange={(event) => editContent(event.target.value)} placeholder="Escribe el contenido de la nota..." /></article>}{error && <p className="error" role="alert">{error}</p>}</section>
      </section>
    </main>
  );
}
