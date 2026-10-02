'use client';

import { useCallback, useEffect, useState } from 'react';
import type { NoteSummary, WorkspaceSummary } from '@syncpad/shared';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:3001';

async function request<T>(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json');
  if (init.method && init.method !== 'GET') {
    const csrf = await fetch(API_URL + '/auth/csrf', { credentials: 'include' });
    const csrfBody = await csrf.json() as { csrfToken: string };
    headers.set('x-csrf-token', csrfBody.csrfToken);
  }
  const response = await fetch(API_URL + path, { ...init, headers, credentials: 'include' });
  const body = response.status === 204 ? undefined : await response.json() as T | { error?: { message?: string } };
  if (!response.ok) throw new Error((body as { error?: { message?: string } })?.error?.message ?? 'No se pudo completar la operación');
  return body as T;
}

export default function Home() {
  const [user, setUser] = useState<{ id: string; email: string } | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [selectedWorkspace, setSelectedWorkspace] = useState<WorkspaceSummary | null>(null);
  const [selectedNote, setSelectedNote] = useState<NoteSummary | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [noteTitle, setNoteTitle] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const selectWorkspace = useCallback(async (workspace: WorkspaceSummary) => {
    setSelectedWorkspace(workspace);
    setSelectedNote(null);
    const result = await request<{ notes: NoteSummary[] }>(`/workspaces/${workspace.id}/notes`);
    setNotes(result.notes);
  }, []);

  const loadWorkspaceList = useCallback(async () => {
    const result = await request<{ workspaces: WorkspaceSummary[] }>('/workspaces');
    setWorkspaces(result.workspaces);
    if (result.workspaces[0]) await selectWorkspace(result.workspaces[0]);
  }, [selectWorkspace]);

  useEffect(() => {
    void request<{ user: { id: string; email: string } }>('/auth/me')
      .then((result) => { setUser(result.user); return loadWorkspaceList(); })
      .catch(() => undefined);
  }, [loadWorkspaceList]);

  async function submitAuth(mode: 'login' | 'register') {
    setBusy(true); setError('');
    try {
      const result = await request<{ user: { id: string; email: string } }>(`/auth/${mode}`, {
        method: 'POST', body: JSON.stringify({ email, password }),
      });
      setUser(result.user); setPassword(''); await loadWorkspaceList();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo iniciar sesión'); }
    finally { setBusy(false); }
  }

  async function createWorkspace() {
    setBusy(true); setError('');
    try { const result = await request<{ workspace: WorkspaceSummary }>('/workspaces', { method: 'POST', body: JSON.stringify({ name: workspaceName }) }); setWorkspaceName(''); await loadWorkspaceList(); await selectWorkspace(result.workspace); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo crear el workspace'); }
    finally { setBusy(false); }
  }

  async function createNote() {
    if (!selectedWorkspace) return;
    setBusy(true); setError('');
    try { const result = await request<{ note: NoteSummary }>(`/workspaces/${selectedWorkspace.id}/notes`, { method: 'POST', body: JSON.stringify({ title: noteTitle }) }); setNoteTitle(''); setNotes((current) => [result.note, ...current]); setSelectedNote(result.note); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo crear la nota'); }
    finally { setBusy(false); }
  }

  async function logout() {
    await request('/auth/logout', { method: 'POST' });
    setUser(null); setWorkspaces([]); setNotes([]); setSelectedWorkspace(null); setSelectedNote(null);
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
        <section className="panel notes-panel"><div className="section-heading"><div><p className="eyebrow">{selectedWorkspace?.name ?? 'Workspace'}</p><h2>Notas</h2></div>{selectedWorkspace && <form className="inline-form" onSubmit={(event) => { event.preventDefault(); void createNote(); }}><input aria-label="Nueva nota" placeholder="Nueva nota" value={noteTitle} onChange={(event) => setNoteTitle(event.target.value)} required /><button disabled={busy} type="submit">Añadir</button></form>}</div>{!selectedWorkspace && <p className="empty">Crea un workspace para empezar.</p>}{selectedWorkspace && !notes.length && <p className="empty">Este workspace todavía no tiene notas.</p>}<div className="note-list">{notes.map((note) => <button className={selectedNote?.id === note.id ? 'note-card active' : 'note-card'} key={note.id} onClick={() => setSelectedNote(note)}><strong>{note.title}</strong><small>Actualizada {new Date(note.updatedAt).toLocaleDateString('es-ES')}</small></button>)}</div>{selectedNote && <article className="editor-preview"><p className="eyebrow">Nota seleccionada</p><h3>{selectedNote.title}</h3><p>El editor colaborativo se conectará en la siguiente etapa de sincronización.</p></article>}{error && <p className="error" role="alert">{error}</p>}</section>
      </section>
    </main>
  );
}
