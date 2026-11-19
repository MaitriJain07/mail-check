import { createHash, randomBytes } from 'node:crypto';
import type { Db, ResultSetHeader, RowDataPacket } from '../db/pool';

export const KEY_PREFIX = 'mc_live_';
const VISIBLE_PREFIX_LEN = KEY_PREFIX.length + 4;

export interface ApiKeyInfo {
  id: number;
  name: string;
  prefix: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

export const hashKey = (key: string): string => createHash('sha256').update(key).digest('hex');

export function isApiKeyFormat(token: string): boolean {
  return token.startsWith(KEY_PREFIX);
}

interface KeyRow extends RowDataPacket {
  id: number;
  user_id: number;
  name: string;
  prefix: string;
  created_at: Date;
  last_used_at: Date | null;
  revoked_at: Date | null;
}

const toInfo = (r: KeyRow): ApiKeyInfo => ({
  id: r.id,
  name: r.name,
  prefix: r.prefix,
  createdAt: r.created_at,
  lastUsedAt: r.last_used_at,
  revokedAt: r.revoked_at,
});

/**
 * 192 bits of randomness, so a plain SHA-256 is enough (no brute-force risk
 * that would call for a slow hash). The plaintext is returned once and never stored.
 */
export async function createApiKey(db: Db, userId: number, name: string): Promise<{ key: string; info: ApiKeyInfo }> {
  const key = KEY_PREFIX + randomBytes(24).toString('base64url');
  const [res] = await db.query<ResultSetHeader>(
    'INSERT INTO api_keys (user_id, name, prefix, key_hash) VALUES (?, ?, ?, ?)',
    [userId, name, key.slice(0, VISIBLE_PREFIX_LEN), hashKey(key)],
  );
  const [rows] = await db.query<KeyRow[]>('SELECT * FROM api_keys WHERE id = ?', [res.insertId]);
  return { key, info: toInfo(rows[0] as KeyRow) };
}

export async function listApiKeys(db: Db, userId: number): Promise<ApiKeyInfo[]> {
  const [rows] = await db.query<KeyRow[]>('SELECT * FROM api_keys WHERE user_id = ? ORDER BY id DESC', [userId]);
  return rows.map(toInfo);
}

/** Returns false if the key does not exist, is not the caller's, or is already revoked. */
export async function revokeApiKey(db: Db, userId: number, id: number): Promise<boolean> {
  const [res] = await db.query<ResultSetHeader>(
    'UPDATE api_keys SET revoked_at = NOW(3) WHERE id = ? AND user_id = ? AND revoked_at IS NULL',
    [id, userId],
  );
  return res.affectedRows > 0;
}

export async function authenticateApiKey(db: Db, key: string): Promise<{ userId: number; apiKeyId: number } | null> {
  const [rows] = await db.query<KeyRow[]>(
    'SELECT id, user_id FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL',
    [hashKey(key)],
  );
  const row = rows[0];
  if (!row) return null;
  // Touch at most once a minute so hot keys do not turn every request into a write.
  void db
    .query(
      'UPDATE api_keys SET last_used_at = NOW(3) WHERE id = ? AND (last_used_at IS NULL OR last_used_at < NOW(3) - INTERVAL 1 MINUTE)',
      [row.id],
    )
    .catch(() => undefined);
  return { userId: row.user_id, apiKeyId: row.id };
}
