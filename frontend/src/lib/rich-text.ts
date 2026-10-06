import type * as Y from 'yjs';
import { LOCAL_EDIT_ORIGIN, type EditorDocument } from './note-document';

/**
 * Bounded formatting on top of the plain `Y.Text` of schema v1 (docs/issues/039-rich-text.md).
 *
 * Marks are Yjs text attributes, so they merge like characters do and a build that ignores them
 * still reads the same plain text. Only the marks below ever reach the screen, and only as React
 * elements: nothing in this module produces HTML.
 */
export const BOLD_MARK = 'bold';
export const LINK_MARK = 'link';
export const LIST_PREFIX = '- ';

const MAX_LINK_LENGTH = 2048;
const ALLOWED_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

export type Run = { text: string; bold: boolean; href: string | null };
export type Block =
  | { type: 'paragraph'; runs: Run[] }
  | { type: 'list'; items: Run[][] };

/**
 * Returns a normalized, safe-to-link URL, or null. Anything that is not plain http(s) or mailto
 * (javascript:, data:, vbscript:, file:, relative paths, URLs with embedded credentials) is refused,
 * whether it was typed here or arrived as an attribute from another client.
 */
export function sanitizeLinkUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!value || value.length > MAX_LINK_LENGTH) return null;
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (!ALLOWED_LINK_PROTOCOLS.has(url.protocol)) return null;
  if (url.username || url.password) return null;
  return url.href;
}

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;
const isLowSurrogate = (code: number) => code >= 0xdc00 && code <= 0xdfff;

/** Widens a selection so it never cuts a surrogate pair in half. */
function widen(text: string, start: number, end: number): [number, number] {
  let from = Math.max(0, Math.min(start, end));
  let to = Math.min(text.length, Math.max(start, end));
  if (from > 0 && isLowSurrogate(text.charCodeAt(from)) && isHighSurrogate(text.charCodeAt(from - 1))) from--;
  if (to > 0 && to < text.length && isLowSurrogate(text.charCodeAt(to)) && isHighSurrogate(text.charCodeAt(to - 1))) to++;
  return [from, to];
}

type DeltaOp = { insert?: unknown; attributes?: Record<string, unknown> };

function readDelta(content: Y.Text): DeltaOp[] {
  return content.toDelta() as DeltaOp[];
}

/** True when every character of [start, end) carries the mark. */
function rangeHasMark(content: Y.Text, start: number, end: number, mark: string): boolean {
  if (end <= start) return false;
  let offset = 0;
  let covered = 0;
  for (const op of readDelta(content)) {
    if (typeof op.insert !== 'string') continue;
    const from = Math.max(start, offset);
    const to = Math.min(end, offset + op.insert.length);
    if (to > from && op.attributes?.[mark] !== undefined && op.attributes[mark] !== null && op.attributes[mark] !== false) covered += to - from;
    offset += op.insert.length;
  }
  return covered === end - start;
}

function format(document: EditorDocument, start: number, end: number, attributes: Record<string, unknown>) {
  document.doc.transact(() => document.content.format(start, end - start, attributes), LOCAL_EDIT_ORIGIN);
}

/** Bolds the selection, or removes bold when all of it is already bold. Returns false for an empty selection. */
export function toggleBold(document: EditorDocument, selectionStart: number, selectionEnd: number): boolean {
  const [start, end] = widen(document.content.toString(), selectionStart, selectionEnd);
  if (end <= start) return false;
  format(document, start, end, { [BOLD_MARK]: rangeHasMark(document.content, start, end, BOLD_MARK) ? null : true });
  return true;
}

/** Links the selection. Returns false for an empty selection or a URL that is not allowed. */
export function setLink(document: EditorDocument, selectionStart: number, selectionEnd: number, url: string): boolean {
  const href = sanitizeLinkUrl(url);
  const [start, end] = widen(document.content.toString(), selectionStart, selectionEnd);
  if (!href || end <= start) return false;
  format(document, start, end, { [LINK_MARK]: href });
  return true;
}

export function removeLink(document: EditorDocument, selectionStart: number, selectionEnd: number): boolean {
  const [start, end] = widen(document.content.toString(), selectionStart, selectionEnd);
  if (end <= start) return false;
  format(document, start, end, { [LINK_MARK]: null });
  return true;
}

/**
 * Makes every line touched by the selection a list item, or removes the markers when all of them
 * already are. Each line is edited on its own so the rest of the text keeps its identity (and its
 * marks) while other clients type nearby.
 */
export function toggleList(document: EditorDocument, selectionStart: number, selectionEnd: number): boolean {
  const text = document.content.toString();
  const from = Math.max(0, Math.min(selectionStart, selectionEnd, text.length));
  const to = Math.min(text.length, Math.max(selectionStart, selectionEnd));
  const lineStarts: number[] = [];
  let lineStart = text.lastIndexOf('\n', from - 1) + 1;
  for (;;) {
    lineStarts.push(lineStart);
    const next = text.indexOf('\n', lineStart);
    if (next === -1 || next + 1 > to) break;
    lineStart = next + 1;
  }
  const allListed = lineStarts.every((start) => text.startsWith(LIST_PREFIX, start));
  document.doc.transact(() => {
    for (const start of lineStarts.reverse()) {
      if (allListed) document.content.delete(start, LIST_PREFIX.length);
      else if (!text.startsWith(LIST_PREFIX, start)) document.content.insert(start, LIST_PREFIX, {});
    }
  }, LOCAL_EDIT_ORIGIN);
  return true;
}

/** Reads the document as safe runs: unknown or hostile attributes are dropped here, once. */
function readRuns(content: Y.Text): Run[] {
  const runs: Run[] = [];
  for (const op of readDelta(content)) {
    if (typeof op.insert !== 'string' || op.insert === '') continue;
    runs.push({ text: op.insert, bold: op.attributes?.[BOLD_MARK] === true, href: sanitizeLinkUrl(op.attributes?.[LINK_MARK]) });
  }
  return runs;
}

function splitLines(runs: Run[]): Run[][] {
  const lines: Run[][] = [[]];
  for (const run of runs) {
    const parts = run.text.split('\n');
    parts.forEach((part, index) => {
      if (index > 0) lines.push([]);
      if (part) lines[lines.length - 1].push({ ...run, text: part });
    });
  }
  return lines;
}

function dropPrefix(line: Run[], length: number): Run[] {
  const rest: Run[] = [];
  let toDrop = length;
  for (const run of line) {
    if (toDrop >= run.text.length) { toDrop -= run.text.length; continue; }
    rest.push(toDrop ? { ...run, text: run.text.slice(toDrop) } : run);
    toDrop = 0;
  }
  return rest;
}

const lineText = (line: Run[]) => line.map((run) => run.text).join('');

/** Groups lines into paragraphs and bullet lists. Blank lines only separate blocks. */
export function readBlocks(content: Y.Text): Block[] {
  const blocks: Block[] = [];
  for (const line of splitLines(readRuns(content))) {
    const text = lineText(line);
    if (text.startsWith(LIST_PREFIX)) {
      const item = dropPrefix(line, LIST_PREFIX.length);
      const last = blocks[blocks.length - 1];
      if (last?.type === 'list') last.items.push(item);
      else blocks.push({ type: 'list', items: [item] });
    } else if (text) {
      blocks.push({ type: 'paragraph', runs: line });
    }
  }
  return blocks;
}
