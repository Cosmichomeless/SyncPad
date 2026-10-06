/**
 * What a note's text is allowed to carry besides characters (docs/issues/054-sanitize-rich-text.md).
 *
 * The frontend keeps an identical copy of the link rules (it runs its own Yjs build); a drift test
 * in document.test.ts fails if the constants stop matching.
 */
export const MAX_LINK_LENGTH = 2048;
export const ALLOWED_LINK_PROTOCOLS = ['http:', 'https:', 'mailto:'] as const;

/** A normalized http(s)/mailto URL without credentials, or null. */
export function sanitizeLinkUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!value || value.length > MAX_LINK_LENGTH) return null;
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (!(ALLOWED_LINK_PROTOCOLS as readonly string[]).includes(url.protocol)) return null;
  if (url.username || url.password) return null;
  return url.href;
}

/**
 * True when a text attribute may be written: `bold` as a boolean (or null to clear it) and `link`
 * as a safe URL (or null to clear it). Everything else is refused, whatever its value.
 */
export function isAllowedTextAttribute(key: string, value: unknown): boolean {
  if (key === 'bold') return value === null || typeof value === 'boolean';
  if (key === 'link') return value === null || sanitizeLinkUrl(value) !== null;
  return false;
}
