import type { Config } from '../config';
import type { Db } from '../db/pool';
import type { Verifier } from '../verifier';

export interface AuthContext {
  userId: number;
  /** null when the caller used a dashboard JWT instead of an API key. */
  apiKeyId: number | null;
  via: 'jwt' | 'apikey';
}

export interface AppDeps {
  db: Db;
  config: Config;
  verifier: Verifier;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}
