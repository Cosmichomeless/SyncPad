import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PendingInvitation, UserId, WorkspaceMember } from '@syncpad/shared';
import { MembersView, type MembersViewProps } from '../src/app/members-panel';
import { HttpError, NetworkError } from '../src/lib/api-request';
import { describeAcceptError, describeMembershipError, inviteLink, readInviteToken } from '../src/lib/invitations';

const members: WorkspaceMember[] = [
  { userId: 'u-owner' as UserId, email: 'owner@example.com', role: 'OWNER', joinedAt: '2026-10-01T00:00:00.000Z' },
  { userId: 'u-ana' as UserId, email: 'ana@example.com', role: 'MEMBER', joinedAt: '2026-10-02T00:00:00.000Z' },
];
const invitations: PendingInvitation[] = [
  { id: 'i1', email: 'luis@example.com', expiresAt: '2026-10-10T00:00:00.000Z', expired: false },
  { id: 'i2', email: 'old@example.com', expiresAt: '2026-09-01T00:00:00.000Z', expired: true },
];
const noop = () => {};
const view = (overrides: Partial<MembersViewProps>) => renderToStaticMarkup(
  <MembersView canManage currentUserId="u-owner" members={members} invitations={invitations} email="" busy={false} error="" createdLink={null} copied={false}
    onEmail={noop} onInvite={noop} onCopy={noop} onRevoke={noop} onRemove={noop} {...overrides} />,
);

test('an OWNER sees who is in, can invite, revoke and remove members', () => {
  const html = view({});
  assert.match(html, /owner@example\.com \(tú\)/);
  assert.match(html, /Propietario/);
  assert.match(html, /Crear enlace de invitación/);
  assert.match(html, /aria-label="Quitar a ana@example\.com"/);
  assert.doesNotMatch(html, /aria-label="Quitar a owner@example\.com"/, 'owners are not removable from the UI');
  assert.match(html, /aria-label="Revocar invitación de luis@example\.com"/);
  assert.match(html, /Caducada/);
});

test('a MEMBER sees the member list but no management controls', () => {
  const html = view({ canManage: false, currentUserId: 'u-ana', invitations: [] });
  assert.match(html, /ana@example\.com \(tú\)/);
  assert.doesNotMatch(html, /Crear enlace de invitación/);
  assert.doesNotMatch(html, /Quitar a/);
  assert.doesNotMatch(html, /Revocar/);
  assert.match(html, /Solo un propietario puede invitar o quitar miembros/);
});

test('the created link is shown once in a read-only field, and pending rows never carry a token', () => {
  const link = inviteLink('http://localhost:4000', 'A'.repeat(43));
  const html = view({ createdLink: link });
  assert.match(html, /readOnly=""/);
  assert.ok(html.includes(`value="${link}"`));
  assert.match(html, /no se volverá a mostrar/);
  assert.doesNotMatch(view({}), /#invite=/);
});

test('loading and error states are announced', () => {
  assert.match(view({ members: null }), /Cargando miembros/);
  assert.match(view({ members: null, error: 'Sin conexión' }), /role="alert"[^>]*>Sin conexión/);
});

test('invitation links use the URL fragment and only well-formed tokens are read back', () => {
  const token = 'abcDEF_-0123456789abcdefghijklmnopqrstuvwxyz'.slice(0, 43);
  assert.equal(inviteLink('https://app.example', token), `https://app.example/#invite=${token}`);
  assert.equal(readInviteToken(`#invite=${token}`), token);
  for (const bad of ['', '#', '#invite=', '#invite=short', `#invite=${token}&x=1`, `#invite=${token}/../`, '#other=' + token, `#invite=${'a'.repeat(200)}`]) {
    assert.equal(readInviteToken(bad), null, bad);
  }
});

test('failures are explained in Spanish without leaking server wording', () => {
  assert.match(describeMembershipError(new NetworkError(new Error('x'))), /Sin conexión/);
  assert.match(describeMembershipError(new HttpError(409, 'English', 'ALREADY_MEMBER')), /ya es miembro/);
  assert.match(describeMembershipError(new HttpError(409, 'English', 'INVITATION_PENDING')), /Revócala/);
  assert.match(describeMembershipError(new HttpError(403, 'English')), /propietario/);
  assert.match(describeMembershipError(new HttpError(400, 'English')), /email válido/);
  assert.match(describeAcceptError(new HttpError(400, 'English')), /caducado|caducar/);
  assert.match(describeAcceptError(new NetworkError(new Error('x'))), /Sin conexión/);
});
