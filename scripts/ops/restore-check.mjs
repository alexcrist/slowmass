import { mkdtemp, chmod, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { decrypt, readKey } from './archive.mjs';
const run = promisify(execFile);
const [archive, keyFile] = process.argv.slice(2);
if (!archive || !keyFile)
  throw new Error(
    'Usage: node scripts/ops/restore-check.mjs <archive> <key-file>',
  );
process.umask(0o077);
const dir = await mkdtemp(join(tmpdir(), 'slowmass-restore-'));
await chmod(dir, 0o700);
try {
  const payload = join(dir, 'payload.tar.gz');
  await decrypt(resolve(archive), payload, await readKey(resolve(keyFile)));
  const listing = await run('tar', ['-tzf', payload]);
  if (
    listing.stdout
      .split('\n')
      .filter(Boolean)
      .some(
        (name) =>
          !/^(database.sql|manifest.json|photos\/?|photos\/[a-f0-9]{64}\.webp)$/.test(
            name,
          ),
      )
  )
    throw new Error('Unexpected archive entry.');
  await run('tar', ['-xzf', payload, '-C', dir]);
  const manifest = JSON.parse(
      await readFile(join(dir, 'manifest.json'), 'utf8'),
    ),
    sql = await readFile(join(dir, 'database.sql'), 'utf8');
  if (
    manifest.version !== 1 ||
    createHash('sha256').update(sql).digest('hex') !== manifest.databaseSha256
  )
    throw new Error('Database checksum mismatch.');
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=OFF');
  db.exec(sql);
  if (
    db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok' ||
    db.prepare('PRAGMA foreign_key_check').all().length
  )
    throw new Error('Database integrity check failed.');
  const required = db
    .prepare(
      "SELECT object_key FROM post WHERE state='published' UNION SELECT object_key FROM avatar",
    )
    .all();
  for (const { object_key: key } of required) {
    const photo = manifest.photos.find((p) => p.key === key);
    if (!photo || !/^[a-f0-9]{64}\.webp$/.test(photo.filename))
      throw new Error('Missing photo manifest entry.');
    const bytes = await readFile(join(dir, 'photos', photo.filename));
    if (
      bytes.length !== photo.bytes ||
      createHash('sha256').update(bytes).digest('hex') !== photo.sha256
    )
      throw new Error('Photo checksum mismatch.');
  }
  // A restored snapshot is quarantined. Never reopen stale sessions or silently restore access.
  db.exec(
    "DELETE FROM session; DELETE FROM verification; UPDATE membership SET status='disabled' WHERE status='active';",
  );
  if (
    db
      .prepare("SELECT COUNT(*) AS n FROM membership WHERE status='active'")
      .get().n !== 0
  )
    throw new Error('Restore quarantine failed.');
  console.log(
    JSON.stringify({
      verified: true,
      createdAt: manifest.createdAt,
      photosVerified: required.length,
      integrity: 'ok',
      sessionsCleared: true,
      restoredAccess: 'disabled',
      productionModified: false,
    }),
  );
  db.close();
} finally {
  await rm(dir, { recursive: true, force: true });
}
