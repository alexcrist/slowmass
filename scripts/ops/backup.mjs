import {
  mkdtemp,
  chmod,
  readFile,
  writeFile,
  rm,
  mkdir,
  stat,
} from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { encrypt, readKey } from './archive.mjs';
const run = promisify(execFile);
const [targetArg, keyArg] = process.argv.slice(2);
if (!targetArg || !keyArg)
  throw new Error(
    'Usage: node scripts/ops/backup.mjs <new-encrypted-archive> <key-file>',
  );
process.umask(0o077);
const target = resolve(targetArg),
  key = await readKey(resolve(keyArg));
await stat(target).then(
  () => {
    throw new Error('Backup target already exists.');
  },
  (e) => {
    if (e.code !== 'ENOENT') throw e;
  },
);
const dir = await mkdtemp(join(tmpdir(), 'slowmass-backup-'));
await chmod(dir, 0o700);
const wrangler = resolve('node_modules/wrangler/bin/wrangler.js');
async function wr(...args) {
  try {
    await run(process.execPath, [wrangler, ...args], {
      maxBuffer: 1024 * 1024,
    });
  } catch {
    throw new Error(
      `Cloudflare operation failed (${args[0]} ${args[1]}). No complete backup created.`,
    );
  }
}
try {
  await mkdir(join(dir, 'photos'));
  await wr(
    'd1',
    'export',
    'slowmass',
    '--env',
    'production',
    '--remote',
    '--output',
    join(dir, 'database.sql'),
  );
  const sql = await readFile(join(dir, 'database.sql'), 'utf8');
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=OFF');
  db.exec(sql);
  const keys = db
    .prepare(
      "SELECT object_key FROM post WHERE state='published' UNION SELECT object_key FROM avatar",
    )
    .all();
  const manifest = {
    version: 1,
    createdAt: new Date().toISOString(),
    databaseSha256: createHash('sha256').update(sql).digest('hex'),
    photos: [],
  };
  for (const { object_key: key } of keys) {
    if (!/^(posts|avatars)\/[a-f0-9-]+\.webp$/.test(key))
      throw new Error('Unexpected stored object key.');
    const filename = createHash('sha256').update(key).digest('hex') + '.webp';
    await wr(
      'r2',
      'object',
      'get',
      `slowmass-photos/${key}`,
      '--remote',
      '--file',
      join(dir, 'photos', filename),
    );
    const bytes = await readFile(join(dir, 'photos', filename));
    manifest.photos.push({
      key,
      filename,
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
  }
  db.close();
  await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest), {
    mode: 0o600,
  });
  await run('tar', [
    '-czf',
    join(dir, 'payload.tar.gz'),
    '-C',
    dir,
    'database.sql',
    'manifest.json',
    'photos',
  ]);
  await encrypt(join(dir, 'payload.tar.gz'), target, key);
  console.log(
    JSON.stringify({
      archive: target,
      createdAt: manifest.createdAt,
      photos: manifest.photos.length,
      encryptedBytes: (await stat(target)).size,
    }),
  );
} finally {
  await rm(dir, { recursive: true, force: true });
}
