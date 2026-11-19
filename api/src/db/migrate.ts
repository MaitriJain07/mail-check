import fs from 'node:fs';
import path from 'node:path';
import mysql from 'mysql2/promise';

const MIGRATIONS_DIR = path.resolve(__dirname, '..', '..', 'migrations');

/**
 * Applies pending *.sql files in filename order. Applied files are recorded in
 * schema_migrations. A named lock stops two processes migrating at once.
 */
export async function runMigrations(url: string, log: (msg: string) => void = () => undefined): Promise<string[]> {
  const conn = await mysql.createConnection({ uri: url, multipleStatements: true });
  const applied: string[] = [];
  try {
    await conn.query('SELECT GET_LOCK("mailcheck_migrate", 30)');
    await conn.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name VARCHAR(255) NOT NULL PRIMARY KEY,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB`);
    const [rows] = await conn.query('SELECT name FROM schema_migrations');
    const done = new Set((rows as { name: string }[]).map((r) => r.name));
    const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      if (done.has(file)) continue;
      log(`applying ${file}`);
      await conn.query(fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'));
      await conn.query('INSERT INTO schema_migrations (name) VALUES (?)', [file]);
      applied.push(file);
    }
    await conn.query('SELECT RELEASE_LOCK("mailcheck_migrate")');
  } finally {
    await conn.end();
  }
  return applied;
}
