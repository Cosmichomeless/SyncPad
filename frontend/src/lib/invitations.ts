import { HttpError, NetworkError } from './api-request';

/** Base64url of 32 random bytes is 43 characters; accept a generous range so a format tweak does not break old links. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,128}$/;

/**
 * The token travels in the URL fragment (`/#invite=…`): fragments are never sent to a server,
 * written to access logs or leaked through the Referer header, unlike a query string.
 */
export function inviteLink(origin: string, token: string): string {
  return `${origin}/#invite=${token}`;
}

/** Extracts a well-formed invitation token from `location.hash`, or null. */
export function readInviteToken(hash: string): string | null {
  const match = /^#invite=([^&]*)$/.exec(hash);
  return match && TOKEN_PATTERN.test(match[1]) ? match[1] : null;
}

/** A person-readable (Spanish) reason for a failed membership operation. */
export function describeMembershipError(cause: unknown): string {
  if (cause instanceof NetworkError) return 'Sin conexión: la gestión de miembros necesita el servidor.';
  if (cause instanceof HttpError) {
    if (cause.code === 'ALREADY_MEMBER') return 'Esa persona ya es miembro de este workspace.';
    if (cause.code === 'INVITATION_PENDING') return 'Ya hay una invitación pendiente para ese email. Revócala para crear un enlace nuevo.';
    if (cause.status === 400) return 'Escribe un email válido.';
    if (cause.status === 401) return 'Tu sesión ha caducado. Vuelve a entrar.';
    if (cause.status === 403) return 'Solo un propietario del workspace puede hacer esto.';
    if (cause.status === 404) return 'Este workspace ya no está disponible para ti.';
  }
  return 'No se pudo completar la operación.';
}

/** Why accepting an invitation failed. The server deliberately does not say which condition failed. */
export function describeAcceptError(cause: unknown): string {
  if (cause instanceof NetworkError) return 'Sin conexión: vuelve a intentarlo cuando tengas red.';
  if (cause instanceof HttpError && cause.status === 400) {
    return 'Esta invitación no es válida: puede haber caducado, haberse usado ya o estar dirigida a otro email.';
  }
  return 'No se pudo aceptar la invitación.';
}
