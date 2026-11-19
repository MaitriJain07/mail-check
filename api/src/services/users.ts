import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { Config } from '../config';
import type { Db, ResultSetHeader, RowDataPacket } from '../db/pool';
import { Errors } from '../errors';

export interface User {
  id: number;
  email: string;
  credits: number;
  createdAt: Date;
}

interface UserRow extends RowDataPacket {
  id: number;
  email: string;
  password_hash: string;
  credits: number;
  created_at: Date;
}

const toUser = (r: UserRow): User => ({ id: r.id, email: r.email, credits: r.credits, createdAt: r.created_at });

// Compared against when the email is unknown so login timing does not reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 4);

export async function registerUser(db: Db, config: Config, email: string, password: string): Promise<User> {
  const hash = await bcrypt.hash(password, config.BCRYPT_ROUNDS);
  try {
    const [res] = await db.query<ResultSetHeader>(
      'INSERT INTO users (email, password_hash, credits) VALUES (?, ?, ?)',
      [email, hash, config.FREE_CREDITS],
    );
    const user = await getUserById(db, res.insertId);
    return user as User;
  } catch (err) {
    if ((err as { code?: string }).code === 'ER_DUP_ENTRY') throw Errors.conflict('An account with this email already exists');
    throw err;
  }
}

export async function loginUser(db: Db, email: string, password: string): Promise<User> {
  const [rows] = await db.query<UserRow[]>('SELECT * FROM users WHERE email = ?', [email]);
  const row = rows[0];
  const ok = await bcrypt.compare(password, row?.password_hash ?? DUMMY_HASH);
  if (!row || !ok) throw Errors.unauthorized('Invalid email or password');
  return toUser(row);
}

export async function getUserById(db: Db, id: number): Promise<User | null> {
  const [rows] = await db.query<UserRow[]>('SELECT * FROM users WHERE id = ?', [id]);
  return rows[0] ? toUser(rows[0]) : null;
}

export function signToken(config: Config, userId: number): string {
  return jwt.sign({}, config.JWT_SECRET, {
    subject: String(userId),
    expiresIn: config.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
    algorithm: 'HS256',
  });
}

export function verifyToken(config: Config, token: string): number | null {
  try {
    const payload = jwt.verify(token, config.JWT_SECRET, { algorithms: ['HS256'] });
    const id = Number(typeof payload === 'object' ? payload.sub : NaN);
    return Number.isInteger(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}
