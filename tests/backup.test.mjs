import { it, expect } from 'vitest';
import {
  mkdtemp,
  readFile,
  writeFile,
  readdir,
  mkdir,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { encrypt, decrypt } from '../scripts/ops/archive.mjs';
const run = promisify(execFile);
it('restores an authenticated encrypted SQL/photo archive in quarantine and rejects tampering', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'slowmass-synthetic-'));
  try {
    const key = randomBytes(32);
    await writeFile(join(dir, 'key'), key, { mode: 0o600 });
    await mkdir(join(dir, 'photos'));
    let sql = '';
    for (const name of (await readdir('migrations'))
      .filter((n) => n.endsWith('.sql'))
      .sort())
      sql += await readFile(`migrations/${name}`, 'utf8');
    sql += `INSERT INTO user VALUES('alice','Alice','alice@example.com',1,NULL,1,1);
  INSERT INTO membership(user_id,joined_at) VALUES('alice',1);
  INSERT INTO profile VALUES('alice','alice','Alice','Bio',1);
  INSERT INTO post VALUES('photo','alice','Caption','Alt',1,1,'published','posts/photo.webp',120,80);`;
    const bytes = await readFile('tests/fixtures/photos/still.webp'),
      filename =
        createHash('sha256').update('posts/photo.webp').digest('hex') + '.webp';
    await writeFile(join(dir, 'photos', filename), bytes);
    await writeFile(join(dir, 'database.sql'), sql);
    await writeFile(
      join(dir, 'manifest.json'),
      JSON.stringify({
        version: 1,
        createdAt: new Date().toISOString(),
        databaseSha256: createHash('sha256').update(sql).digest('hex'),
        photos: [
          {
            key: 'posts/photo.webp',
            filename,
            bytes: bytes.length,
            sha256: createHash('sha256').update(bytes).digest('hex'),
          },
        ],
      }),
    );
    await run('tar', [
      '-czf',
      join(dir, 'payload.tar.gz'),
      '-C',
      dir,
      'database.sql',
      'manifest.json',
      'photos',
    ]);
    await encrypt(join(dir, 'payload.tar.gz'), join(dir, 'backup.enc'), key);
    const result = await run(process.execPath, [
      resolve('scripts/ops/restore-check.mjs'),
      join(dir, 'backup.enc'),
      join(dir, 'key'),
    ]);
    expect(JSON.parse(result.stdout)).toMatchObject({
      verified: true,
      photosVerified: 1,
      restoredAccess: 'disabled',
      sessionsCleared: true,
      productionModified: false,
    });
    const encrypted = await readFile(join(dir, 'backup.enc'));
    encrypted[30] ^= 1;
    await writeFile(join(dir, 'tampered.enc'), encrypted);
    await expect(
      decrypt(join(dir, 'tampered.enc'), join(dir, 'untrusted'), key),
    ).rejects.toThrow();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
