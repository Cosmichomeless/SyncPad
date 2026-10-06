import assert from 'node:assert/strict';
import test from 'node:test';
import type { ReactElement, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import NoteSyncStatus from '../src/app/note-sync-status';
import type { SyncState } from '../src/lib/note-sync';

const LABELS: Record<SyncState, string> = {
  offline: 'Sin conexión',
  reconnecting: 'Reconectando',
  syncing: 'Sincronizando',
  'up-to-date': 'Al día',
};

function render(state: SyncState, options: { networkOnline?: boolean; retry?: () => void } = {}) {
  return renderToStaticMarkup(<NoteSyncStatus state={state} retry={options.retry ?? (() => {})} networkOnline={options.networkOnline} />);
}

/** Finds the first element of `type` in the tree the component returns, without needing a DOM. */
function findElement(node: ReactNode, type: string): ReactElement<{ onClick?: () => void; disabled?: boolean }> | undefined {
  if (!node || typeof node !== 'object') return undefined;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, type);
      if (found) return found;
    }
    return undefined;
  }
  const element = node as ReactElement<{ children?: ReactNode }>;
  if (element.type === type) return element as ReactElement<{ onClick?: () => void; disabled?: boolean }>;
  return findElement(element.props?.children, type);
}

test('every state renders its exact Spanish label in one polite, atomic live region', () => {
  for (const [state, label] of Object.entries(LABELS) as [SyncState, string][]) {
    const html = render(state);
    assert.match(html, new RegExp(`<p role="status" aria-live="polite" aria-atomic="true">${label}</p>`));
    assert.equal(html.match(/role="status"/g)?.length, 1, `${state} has exactly one live region`);
  }
});

test('the status dot is decorative and the state is never conveyed by colour alone', () => {
  for (const state of Object.keys(LABELS) as SyncState[]) {
    const html = render(state);
    assert.match(html, new RegExp(`<span class="sync-dot sync-${state}" aria-hidden="true"></span>`));
  }
});

test('up-to-date offers no retry; every other state does', () => {
  assert.doesNotMatch(render('up-to-date'), /<button/);
  for (const state of ['offline', 'reconnecting', 'syncing'] as SyncState[]) {
    assert.match(render(state), /<button type="button"[^>]*>Reintentar conexión<\/button>/);
  }
});

test('retry stays enabled after a failure while the browser is online', () => {
  assert.doesNotMatch(render('offline', { networkOnline: true }), /<button[^>]*disabled/);
  assert.doesNotMatch(render('reconnecting'), /<button[^>]*disabled/);
});

test('retry is disabled only while the browser itself is offline, and says why', () => {
  const html = render('offline', { networkOnline: false });
  assert.match(html, /<button[^>]*disabled=""[^>]*>Reintentar conexión<\/button>/);
  assert.match(html, /Se reanudará automáticamente al volver la red/);
  assert.doesNotMatch(render('reconnecting', { networkOnline: false }), /<button[^>]*disabled/);
});

test('clicking retry delegates to the controller callback exactly once', () => {
  let calls = 0;
  const tree = NoteSyncStatus({ state: 'offline', retry: () => { calls++; }, networkOnline: true });
  const button = findElement(tree, 'button');
  assert.ok(button?.props.onClick, 'a retry button with a handler is rendered');
  button.props.onClick();
  assert.equal(calls, 1);
});
