import * as Y from 'yjs';
import type { AwarenessCursor, AwarenessUser } from '@syncpad/shared';

const CONTEXT_CHARS = 24;
const SELECTED_CHARS = 60;

export type Participant = {
  userId: string;
  email: string;
  /** Local part of the email, which is what people recognise. */
  name: string;
  color: string;
  isSelf: boolean;
  /** Open tabs/devices of this user in the note. */
  connections: number;
};

export type RemoteSelection = {
  userId: string;
  connectionId: string;
  name: string;
  color: string;
  before: string;
  selected: string;
  after: string;
};

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (value: string) => Uint8Array.from(atob(value), (character) => character.charCodeAt(0));

/** The same user always gets the same colour, on every device, derived from the stable user id. */
export function colorFor(userId: string): string {
  let hash = 0;
  for (let index = 0; index < userId.length; index++) hash = (hash * 31 + userId.charCodeAt(index)) >>> 0;
  return `hsl(${hash % 360} 65% 38%)`;
}

/** One entry per user (several tabs collapse into one), yourself first, the rest by name. */
export function groupParticipants(users: AwarenessUser[], self: string | null): Participant[] {
  const selfUser = users.find((user) => user.connectionId === self)?.userId;
  const byUser = new Map<string, Participant>();
  for (const user of users) {
    const existing = byUser.get(user.userId);
    if (existing) { existing.connections++; continue; }
    byUser.set(user.userId, {
      userId: user.userId,
      email: user.email,
      name: user.email.split('@')[0] || user.email,
      color: colorFor(user.userId),
      isSelf: user.userId === selfUser,
      connections: 1,
    });
  }
  return [...byUser.values()].sort((a, b) => Number(b.isSelf) - Number(a.isSelf) || a.name.localeCompare(b.name) || a.userId.localeCompare(b.userId));
}

/** Encodes a selection as Yjs relative positions so it keeps pointing at the same text while others edit. */
export function encodeCursor(content: Y.Text, start: number, end: number): AwarenessCursor {
  const position = (index: number) => toBase64(Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(content, Math.max(0, Math.min(index, content.length)))));
  return { anchor: position(start), head: position(end) };
}

/** Resolves a peer's cursor against our copy; anything undecodable or foreign is simply ignored. */
export function resolveCursor(content: Y.Text, cursor: AwarenessCursor | null | undefined): { start: number; end: number } | null {
  if (!cursor || typeof cursor.anchor !== 'string' || typeof cursor.head !== 'string') return null;
  try {
    const resolve = (encoded: string) => {
      const absolute = Y.createAbsolutePositionFromRelativePosition(Y.decodeRelativePosition(fromBase64(encoded)), content.doc!);
      return absolute && absolute.type === content ? Math.min(absolute.index, content.length) : null;
    };
    const anchor = resolve(cursor.anchor);
    const head = resolve(cursor.head);
    if (anchor === null || head === null) return null;
    return { start: Math.min(anchor, head), end: Math.max(anchor, head) };
  } catch {
    return null;
  }
}

/** What each other participant has selected right now, with a little surrounding text for context. */
export function remoteSelections(content: Y.Text, users: AwarenessUser[], self: string | null): RemoteSelection[] {
  const text = content.toString();
  const result: RemoteSelection[] = [];
  for (const user of users) {
    if (user.connectionId === self) continue;
    const range = resolveCursor(content, user.cursor);
    if (!range) continue;
    const selected = text.slice(range.start, range.end);
    result.push({
      userId: user.userId,
      connectionId: user.connectionId,
      name: user.email.split('@')[0] || user.email,
      color: colorFor(user.userId),
      before: (range.start > CONTEXT_CHARS ? '…' : '') + text.slice(Math.max(0, range.start - CONTEXT_CHARS), range.start),
      selected: selected.length > SELECTED_CHARS ? `${selected.slice(0, SELECTED_CHARS)}…` : selected,
      after: text.slice(range.end, range.end + CONTEXT_CHARS) + (range.end + CONTEXT_CHARS < text.length ? '…' : ''),
    });
  }
  return result;
}
