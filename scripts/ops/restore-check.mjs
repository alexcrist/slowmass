import { mkdtemp, chmod, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { decrypt, readKey } from './archive.mjs';
import { requiredPhotoKeys } from './photo-keys.mjs';
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
  const required = requiredPhotoKeys(db);
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
  for (const table of [
    'push_delivery',
    'push_subscription',
    'invite_link_claim',
    'event_claim',
  ]) {
    if (
      db
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
        .get(table)
    ) {
      db.exec(`DELETE FROM ${table}`);
      if (db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get())
        throw new Error('Push quarantine failed.');
    }
  }
  db.exec(
    "DELETE FROM session; DELETE FROM verification; UPDATE membership SET status='disabled' WHERE status='active';",
  );
  // Join links are independent of the auth secret. Do not revive their access
  // when an operator later re-enables a restored inviter's membership.
  const invitationColumns = new Set(
    db
      .prepare('PRAGMA table_info(invitation)')
      .all()
      .map((column) => column.name),
  );
  for (const column of ['join_token_hash', 'email_payload']) {
    if (!invitationColumns.has(column)) continue;
    db.exec(`UPDATE invitation SET ${column}=NULL`);
    if (
      db
        .prepare(`SELECT 1 FROM invitation WHERE ${column} IS NOT NULL LIMIT 1`)
        .get()
    )
      throw new Error('Invitation credential quarantine failed.');
  }
  if (
    db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='invite_link'",
      )
      .get()
  ) {
    db.exec(
      'UPDATE invite_link SET token_encrypted=NULL,revoked_at=COALESCE(revoked_at,unixepoch()*1000)',
    );
    if (
      db
        .prepare(
          'SELECT 1 FROM invite_link WHERE token_encrypted IS NOT NULL OR revoked_at IS NULL LIMIT 1',
        )
        .get()
    )
      throw new Error('Shared invitation quarantine failed.');
  }
  // Event links are the only invitations and, like join links, do not depend
  // on the auth secret. A new version also ends access granted by opening an
  // old link. Links cannot be replaced, so a quarantined event invites no one
  // new; hosts and people who answered keep access.
  if (
    db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='event'",
      )
      .get()
  ) {
    db.exec(
      "UPDATE event SET link_id='quarantined:'||id,link_hash='quarantined:'||id,link_encrypted=NULL",
    );
    if (
      db
        .prepare(
          "SELECT 1 FROM event WHERE link_encrypted IS NOT NULL OR link_hash NOT LIKE 'quarantined:%' LIMIT 1",
        )
        .get()
    )
      throw new Error('Event link quarantine failed.');
  }
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
      invitationCredentialsCleared: true,
      pushSubscriptionsCleared: true,
      restoredAccess: 'disabled',
      productionModified: false,
    }),
  );
  db.close();
} finally {
  await rm(dir, { recursive: true, force: true });
}
