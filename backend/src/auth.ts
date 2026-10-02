import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import type { QueryResult, QueryResultRow } from 'pg';
import type { UserId } from '@syncpad/shared';

const PASSWORD_COST = 16_384;
const PASSWORD_BLOCK_SIZE = 8;
const PASSWORD_PARALLELIZATION = 1;
const PASSWORD_KEY_LENGTH = 64;
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;

function deriveKey(password: string, salt: Buffer, length: number) {
  return new Promise<Buffer>((resolve, reject) => {
    scryptCallback(password, salt, length, {
      N: PASSWORD_COST,
      r: PASSWORD_BLOCK_SIZE,
      p: PASSWORD_PARALLELIZATION,
      maxmem: 32 * 1024 * 1024,
    }, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

export type AuthUser = {
  id: UserId;
  email: string;
};

export interface SqlExecutor {
  query<T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<T>>;
}

export class EmailAlreadyRegisteredError extends Error {
  constructor() {
    super('Email is already registered');
    this.name = 'EmailAlreadyRegisteredError';
  }
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derivedKey = await deriveKey(password, salt, PASSWORD_KEY_LENGTH);
  return [
    'scrypt',
    PASSWORD_COST,
    PASSWORD_BLOCK_SIZE,
    PASSWORD_PARALLELIZATION,
    salt.toString('base64url'),
    derivedKey.toString('base64url'),
  ].join('$');
}

export async function verifyPassword(password: string, encodedHash: string): Promise<boolean> {
  const [, rawCost, rawBlockSize, rawParallelization, encodedSalt, encodedKey] = encodedHash.split('$');
  const cost = Number(rawCost);
  const blockSize = Number(rawBlockSize);
  const parallelization = Number(rawParallelization);
  if (!encodedSalt || !encodedKey || cost !== PASSWORD_COST || blockSize !== PASSWORD_BLOCK_SIZE || parallelization !== PASSWORD_PARALLELIZATION) {
    return false;
  }
  const salt = Buffer.from(encodedSalt, 'base64url');
  const expectedKey = Buffer.from(encodedKey, 'base64url');
  const actualKey = await deriveKey(password, salt, expectedKey.length);
  return actualKey.length === expectedKey.length && timingSafeEqual(actualKey, expectedKey);
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function sessionTokenHash(token: string) {
  return createHash('sha256').update(token).digest('base64url');
}

function toUser(row: { id: string; email: string }): AuthUser {
  return { id: row.id as UserId, email: row.email };
}

export function createAuthService(database: SqlExecutor) {
  return {
    async register(email: string, password: string): Promise<AuthUser> {
      const normalizedEmail = normalizeEmail(email);
      if (!normalizedEmail || password.length < 8) throw new Error('Invalid credentials');
      const passwordHash = await hashPassword(password);
      try {
        const result = await database.query<{ id: string; email: string }>(
          'INSERT INTO syncpad.users (email, password_hash) VALUES ($1, $2) RETURNING id, email',
          [normalizedEmail, passwordHash],
        );
        return toUser(result.rows[0]);
      } catch (error) {
        if ((error as { code?: string }).code === '23505') throw new EmailAlreadyRegisteredError();
        throw error;
      }
    },

    async authenticate(email: string, password: string): Promise<AuthUser | null> {
      const result = await database.query<{ id: string; email: string; password_hash: string }>(
        'SELECT id, email, password_hash FROM syncpad.users WHERE lower(email) = $1',
        [normalizeEmail(email)],
      );
      const row = result.rows[0];
      if (!row || !(await verifyPassword(password, row.password_hash))) return null;
      return toUser(row);
    },

    async createSession(userId: UserId): Promise<string> {
      const token = randomBytes(32).toString('base64url');
      await database.query(
        'INSERT INTO syncpad.sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
        [userId, sessionTokenHash(token), new Date(Date.now() + SESSION_TTL_MS)],
      );
      return token;
    },

    async getUserBySession(token: string): Promise<AuthUser | null> {
      const result = await database.query<{ id: string; email: string }>(
        `SELECT users.id, users.email
         FROM syncpad.sessions
         INNER JOIN syncpad.users ON users.id = sessions.user_id
         WHERE sessions.token_hash = $1
           AND sessions.revoked_at IS NULL
           AND sessions.expires_at > now()`,
        [sessionTokenHash(token)],
      );
      return result.rows[0] ? toUser(result.rows[0]) : null;
    },

    async invalidateSession(token: string): Promise<void> {
      await database.query(
        'UPDATE syncpad.sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL',
        [sessionTokenHash(token)],
      );
    },
  };
}