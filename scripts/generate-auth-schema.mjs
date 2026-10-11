import { DatabaseSync } from 'node:sqlite';
import { getMigrations } from 'better-auth/db/migration';

// Prints a fresh reference schema; review differences before adding a migration.
const db = new DatabaseSync(':memory:');
try {
  const migration = await getMigrations({
    database: db,
    rateLimit: { enabled: true, storage: 'database' },
  });
  process.stdout.write(await migration.compileMigrations());
} finally {
  db.close();
}
