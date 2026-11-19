import { config } from '../config';
import { runMigrations } from '../db/migrate';

runMigrations(config.DATABASE_URL, (m) => console.log(`[migrate] ${m}`))
  .then((applied) => console.log(`[migrate] done (${applied.length} applied)`))
  .catch((err) => {
    console.error('[migrate] failed:', err.message);
    process.exit(1);
  });
