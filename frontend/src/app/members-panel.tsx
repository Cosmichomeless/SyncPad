'use client';

import { useEffect, useState, type FormEvent } from 'react';
import type { PendingInvitation, WorkspaceMember, WorkspaceSummary } from '@syncpad/shared';
import { request } from '../lib/api-request';
import { describeMembershipError, inviteLink } from '../lib/invitations';

export type MembersViewProps = {
  /** Management controls render only for an OWNER; the server enforces the same rule. */
  canManage: boolean;
  currentUserId: string;
  members: WorkspaceMember[] | null;
  invitations: PendingInvitation[];
  email: string;
  busy: boolean;
  error: string;
  /** The link of the invitation just created. It is shown once: the server only keeps its hash. */
  createdLink: string | null;
  copied: boolean;
  onEmail(value: string): void;
  onInvite(): void;
  onCopy(): void;
  onRevoke(invitation: PendingInvitation): void;
  onRemove(member: WorkspaceMember): void;
};

const dateFormat = (iso: string) => new Date(iso).toLocaleDateString('es-ES');

const MEMBERS_POLL_MS = 20_000;

export function MembersView(props: MembersViewProps) {
  const { canManage, currentUserId, members, invitations, email, busy, error, createdLink, copied } = props;
  return (
    <section className="members" aria-label="Miembros del workspace">
      <h3>Miembros</h3>
      {members === null && !error && <p className="empty">Cargando miembros…</p>}
      {members && (
        <ul className="member-list" aria-label="Miembros">
          {members.map((member) => (
            <li key={member.userId}>
              <span className="member-email">{member.email}{member.userId === currentUserId && ' (tú)'}</span>
              <span className={member.role === 'OWNER' ? 'role-badge owner' : 'role-badge'}>{member.role === 'OWNER' ? 'Propietario' : 'Miembro'}</span>
              {canManage && member.role === 'MEMBER' && (
                <button type="button" className="quiet" aria-label={`Quitar a ${member.email}`} disabled={busy} onClick={() => props.onRemove(member)}>Quitar</button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canManage && (
        <>
          <form className="invite-form" onSubmit={(event: FormEvent) => { event.preventDefault(); props.onInvite(); }}>
            <label>Invitar por email<input type="email" value={email} onChange={(event) => props.onEmail(event.target.value)} placeholder="persona@ejemplo.com" required /></label>
            <button type="submit" disabled={busy}>Crear enlace de invitación</button>
          </form>
          {createdLink && (
            <div className="invite-created" role="status">
              <p>Comparte este enlace solo con esa persona. Es de un solo uso, caduca en 7 días y <strong>no se volverá a mostrar</strong>.</p>
              <input readOnly aria-label="Enlace de invitación" value={createdLink} onFocus={(event) => event.currentTarget.select()} />
              <button type="button" onClick={props.onCopy}>{copied ? 'Copiado' : 'Copiar enlace'}</button>
            </div>
          )}
          {invitations.length > 0 && (
            <ul className="member-list" aria-label="Invitaciones pendientes">
              {invitations.map((invitation) => (
                <li key={invitation.id}>
                  <span className="member-email">{invitation.email}</span>
                  <span className="role-badge pending-badge">{invitation.expired ? 'Caducada' : `Pendiente · hasta ${dateFormat(invitation.expiresAt)}`}</span>
                  <button type="button" className="quiet" aria-label={`Revocar invitación de ${invitation.email}`} disabled={busy} onClick={() => props.onRevoke(invitation)}>Revocar</button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {!canManage && members && <p className="empty">Solo un propietario puede invitar o quitar miembros.</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}

/** Loads and manages one workspace's members. Mount with `key={workspace.id}` so state never leaks between workspaces. */
export default function MembersPanel({ workspace, currentUserId }: { workspace: WorkspaceSummary; currentUserId: string }) {
  // Copies cached before roles existed carry no role: they get no controls (the server would refuse anyway).
  const canManage = workspace.role === 'OWNER';
  const [members, setMembers] = useState<WorkspaceMember[] | null>(null);
  const [invitations, setInvitations] = useState<PendingInvitation[]>([]);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [createdLink, setCreatedLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [version, setVersion] = useState(0);
  const base = `/workspaces/${workspace.id}`;
  const refresh = () => setVersion((value) => value + 1);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const loaded = await request<{ members: WorkspaceMember[] }>(`${base}/members`);
        const pending = canManage ? await request<{ invitations: PendingInvitation[] }>(`${base}/invitations`) : { invitations: [] };
        if (cancelled) return;
        setMembers(loaded.members); setInvitations(pending.invitations);
      } catch (cause) {
        if (!cancelled) setError(describeMembershipError(cause));
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [base, canManage, version]);

  // Other people join or leave while this tab is open: refresh when the tab regains focus and periodically.
  useEffect(() => {
    const reload = () => setVersion((value) => value + 1);
    const timer = setInterval(() => { if (window.document.visibilityState === 'visible') reload(); }, MEMBERS_POLL_MS);
    window.addEventListener('focus', reload);
    return () => { clearInterval(timer); window.removeEventListener('focus', reload); };
  }, []);

  async function act(operation: () => Promise<void>) {
    setBusy(true); setError('');
    try { await operation(); refresh(); }
    catch (cause) { setError(describeMembershipError(cause)); }
    finally { setBusy(false); }
  }

  const invite = () => act(async () => {
    const result = await request<{ invitation: { token: string } }>(`${base}/invitations`, { method: 'POST', body: JSON.stringify({ email }) });
    setCreatedLink(inviteLink(window.location.origin, result.invitation.token));
    setCopied(false); setEmail('');
  });

  async function copy() {
    if (!createdLink) return;
    try { await navigator.clipboard.writeText(createdLink); setCopied(true); }
    catch { setError('No se pudo copiar automáticamente: selecciona el enlace y cópialo a mano.'); }
  }

  return (
    <MembersView
      canManage={canManage} currentUserId={currentUserId} members={members} invitations={invitations}
      email={email} busy={busy} error={error} createdLink={createdLink} copied={copied}
      onEmail={setEmail} onInvite={() => void invite()} onCopy={() => void copy()}
      onRevoke={(invitation) => void act(async () => { await request(`${base}/invitations/${invitation.id}`, { method: 'DELETE' }); })}
      onRemove={(member) => {
        if (!window.confirm(`¿Quitar a ${member.email} del workspace? Perderá el acceso a sus notas.`)) return;
        void act(async () => { await request(`${base}/members/${member.userId}`, { method: 'DELETE' }); });
      }}
    />
  );
}
