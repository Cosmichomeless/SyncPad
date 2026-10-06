import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import * as Y from 'yjs';
import type { AwarenessUser } from '@syncpad/shared';
import PresenceBar, { summary } from '../src/app/presence-bar';
import { colorFor, encodeCursor, groupParticipants, remoteSelections, resolveCursor } from '../src/lib/presence';

const user = (connectionId: string, userId: string, email: string, cursor?: AwarenessUser['cursor']): AwarenessUser => ({ connectionId, userId, email, cursor });

function textOf(value: string) {
  const doc = new Y.Doc();
  const content = doc.getText('content');
  content.insert(0, value);
  return { doc, content };
}

test('identity is stable: the same user id always gets the same colour', () => {
  assert.equal(colorFor('user-1'), colorFor('user-1'));
  assert.notEqual(colorFor('user-1'), colorFor('user-2'));
  assert.match(colorFor('user-1'), /^hsl\(\d+ 65% 38%\)$/);
});

test('participants collapse tabs per user, put you first and sort the rest by name', () => {
  const users = [user('c1', 'u-zoe', 'zoe@example.com'), user('c2', 'u-ana', 'ana@example.com'), user('c3', 'u-me', 'me@example.com'), user('c4', 'u-ana', 'ana@example.com')];
  const grouped = groupParticipants(users, 'c3');
  assert.deepEqual(grouped.map((p) => [p.name, p.isSelf, p.connections]), [['me', true, 1], ['ana', false, 2], ['zoe', false, 1]]);
  assert.equal(grouped[1].color, colorFor('u-ana'));
  assert.deepEqual(groupParticipants([], null), []);
});

test('a participant who disconnects disappears from the next presence list', () => {
  const before = groupParticipants([user('c1', 'u-me', 'me@example.com'), user('c2', 'u-ana', 'ana@example.com')], 'c1');
  const after = groupParticipants([user('c1', 'u-me', 'me@example.com')], 'c1');
  assert.equal(before.length, 2);
  assert.deepEqual(after.map((p) => p.userId), ['u-me']);
});

test('a cursor follows the text while others edit before it', () => {
  const { content } = textOf('hola mundo');
  const cursor = encodeCursor(content, 5, 10);
  assert.deepEqual(resolveCursor(content, cursor), { start: 5, end: 10 });
  content.insert(0, '¡¡¡ ');
  assert.deepEqual(resolveCursor(content, cursor), { start: 9, end: 14 });
  assert.equal(content.toString().slice(9, 14), 'mundo');
  content.delete(0, content.length);
  assert.deepEqual(resolveCursor(content, cursor), { start: 0, end: 0 });
});

test('undecodable, empty or foreign cursors are ignored, never thrown', () => {
  const { content } = textOf('abc');
  const other = textOf('xyz');
  assert.equal(resolveCursor(content, null), null);
  assert.equal(resolveCursor(content, undefined), null);
  assert.equal(resolveCursor(content, { anchor: '@@@', head: '###' }), null);
  assert.equal(resolveCursor(content, { anchor: 'AQID', head: 'AQID' }), null);
  assert.equal(resolveCursor(content, encodeCursor(other.content, 0, 1)), null);
});

test('remote selections skip yourself and add context around the selected text', () => {
  const { content } = textOf('uno dos tres cuatro cinco seis siete ocho nueve diez once doce trece');
  const users = [
    user('me', 'u-me', 'me@example.com', encodeCursor(content, 0, 3)),
    user('c2', 'u-ana', 'ana@example.com', encodeCursor(content, 26, 30)),
    user('c3', 'u-bob', 'bob@example.com'),
  ];
  const result = remoteSelections(content, users, 'me');
  assert.equal(result.length, 1);
  assert.equal(result[0].name, 'ana');
  assert.equal(result[0].selected, 'seis');
  assert.ok(result[0].before.startsWith('…') && result[0].after.endsWith('…'));
});

test('PresenceBar renders names and selections as text, escaping hostile input', () => {
  const html = renderToStaticMarkup(
    <PresenceBar
      participants={[{ userId: 'u1', email: '<b>x</b>@example.com', name: '<b>x</b>', color: 'hsl(1 65% 38%)', isSelf: true, connections: 2 }]}
      selections={[{ userId: 'u2', connectionId: 'c2', name: 'ana', color: 'hsl(2 65% 38%)', before: 'a ', selected: '<img src=x onerror=alert(1)>', after: ' z' }]}
    />,
  );
  assert.ok(!html.includes('<b>x</b>') && !html.includes('<img'));
  assert.ok(html.includes('&lt;img'));
  assert.ok(html.includes('(tú)') && html.includes('2 pestañas'));
  assert.ok(html.includes('aria-label="Participantes conectados"'));
  assert.equal(renderToStaticMarkup(<PresenceBar participants={[]} selections={[]} />), '');
});

test('presence has an accessible text: a polite live summary and a caret that is read as text (#56)', () => {
  const participants = [
    { userId: 'u1', email: 'me@example.com', name: 'me', color: 'hsl(1 65% 38%)', isSelf: true, connections: 1 },
    { userId: 'u2', email: 'ana@example.com', name: 'ana', color: 'hsl(2 65% 38%)', isSelf: false, connections: 1 },
  ];
  const html = renderToStaticMarkup(
    <PresenceBar participants={participants} selections={[{ userId: 'u2', connectionId: 'c2', name: 'ana', color: 'hsl(2 65% 38%)', before: 'a', selected: '', after: 'b' }]} />,
  );
  assert.match(html, /<p class="sr-only" role="status" aria-live="polite" aria-atomic="true">2 participantes conectados: me \(tú\), ana<\/p>/);
  assert.equal(html.match(/role="status"/g)?.length, 1);
  // aria-label on a plain span is not exposed reliably; the caret must be real hidden text instead.
  assert.ok(!html.includes('aria-label="cursor"'));
  assert.match(html, /<span aria-hidden="true">\|<\/span><span class="sr-only"> cursor <\/span>/);
  assert.equal(summary([participants[0]]), '1 participante conectado: me (tú)');
});
