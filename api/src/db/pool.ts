import mysql, { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { config } from '../config';

export type Db = Pool;
export type Conn = PoolConnection;

export function createPool(url = config.DATABASE_URL, size = config.DB_POOL_SIZE): Pool {
  return mysql.createPool({
    uri: url,
    connectionLimit: size,
    timezone: 'Z',
    dateStrings: false,
    // Numbers stay numbers for BIGINT ids and counters (all well below 2^53).
    supportBigNumbers: true,
    bigNumberStrings: false,
    decimalNumbers: true,
    namedPlaceholders: false,
  });
}

export { ResultSetHeader, RowDataPacket };

/** Run `fn` inside a transaction; rolls back on throw. */
export async function withTransaction<T>(db: Db, fn: (conn: Conn) => Promise<T>): Promise<T> {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const out = await fn(conn);
    await conn.commit();
    return out;
  } catch (err) {
    await conn.rollback().catch(() => undefined);
    throw err;
  } finally {
    conn.release();
  }
}
