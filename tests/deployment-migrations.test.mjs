import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { checkMigrationHistory } from '../scripts/ops/check-deploy-migrations.mjs';

const run = promisify(execFile);
const wrangler = resolve('node_modules/wrangler/bin/wrangler.js');

it('preserves old reads/writes, rolls back a failing migration, and resumes without reapplying completed migrations', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'slowmass-migration-test-'));
  const names = ['0001_initial.sql', '0002_expand.sql', '0003_failed.sql'];
  const policy = Object.fromEntries(names.map((name) => [name, 'automatic']));
  const wr = (...args) =>
    run(process.execPath, [wrangler, 'd1', ...args], {
      cwd: dir,
      env: {
        ...process.env,
        CI: 'true',
        WRANGLER_SEND_METRICS: 'false',
        CLOUDFLARE_API_TOKEN: '',
        CLOUDFLARE_ACCOUNT_ID: '',
      },
      maxBuffer: 1024 * 1024,
    });
  const apply = () => wr('migrations', 'apply', 'fixture', '--local');
  const query = async (sql) =>
    JSON.parse(
      (await wr('execute', 'fixture', '--local', '--command', sql, '--json'))
        .stdout,
    );
  const history = () => query('SELECT name FROM d1_migrations ORDER BY name');
  try {
    await mkdir(join(dir, 'migrations'));
    await writeFile(
      join(dir, 'wrangler.json'),
      JSON.stringify({
        name: 'migration-fixture',
        compatibility_date: '2026-10-10',
        d1_databases: [
          {
            binding: 'DB',
            database_name: 'fixture',
            database_id: '00000000-0000-0000-0000-000000000001',
            migrations_dir: 'migrations',
          },
        ],
      }),
    );
    await writeFile(
      join(dir, 'migrations', names[0]),
      "CREATE TABLE item (id INTEGER PRIMARY KEY, name TEXT NOT NULL); INSERT INTO item VALUES (1, 'existing');",
    );
    await apply();
    await writeFile(
      join(dir, 'migrations', names[1]),
      'ALTER TABLE item ADD COLUMN label TEXT;',
    );
    await writeFile(
      join(dir, 'migrations', names[2]),
      'CREATE TABLE rolled_back (id INTEGER); INSERT INTO missing_table VALUES (1);',
    );
    expect(checkMigrationHistory(names, await history(), policy)).toEqual(
      names.slice(1),
    );
    await expect(apply()).rejects.toThrow();
    const afterFailure = await history();
    expect(afterFailure[0].results.map((row) => row.name)).toEqual(
      names.slice(0, 2),
    );
    expect(() => checkMigrationHistory(names, afterFailure)).toThrow(
      'Pending: 0003_failed.sql',
    );
    expect(
      (
        await query("SELECT name FROM sqlite_master WHERE name = 'rolled_back'")
      )[0].results,
    ).toEqual([]);
    // The previous app's explicit-column writes and reads still work after expansion.
    await query("INSERT INTO item (id, name) VALUES (2, 'old-client')");
    expect(
      (await query('SELECT id, name FROM item ORDER BY id'))[0].results,
    ).toEqual([
      { id: 1, name: 'existing' },
      { id: 2, name: 'old-client' },
    ]);
    // Only the unapplied synthetic migration is corrected; applied SQL stays unchanged.
    await writeFile(
      join(dir, 'migrations', names[2]),
      'CREATE TABLE recovered (id INTEGER);',
    );
    expect(checkMigrationHistory(names, await history(), policy)).toEqual([
      names[2],
    ]);
    await apply();
    expect(checkMigrationHistory(names, await history())).toEqual([]);
    await apply();
    expect(checkMigrationHistory(names, await history())).toEqual([]);
    expect(
      (await query('SELECT count(*) AS count FROM item'))[0].results,
    ).toEqual([{ count: 2 }]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 60000);
