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
it.each(['legacy', 'thumbnails', 'large avatars'])(
  'restores encrypted archives with all required photo variants (%s)',
  async (schema) => {
    const thumbnails = schema !== 'legacy';
    const largeAvatars = schema === 'large avatars';
    const dir = await mkdtemp(join(tmpdir(), 'slowmass-synthetic-'));
    try {
      const key = randomBytes(32);
      await writeFile(join(dir, 'key'), key, { mode: 0o600 });
      await mkdir(join(dir, 'photos'));
      let sql = '';
      for (const name of (await readdir('migrations'))
        .filter(
          (n) =>
            n.endsWith('.sql') &&
            (schema === 'legacy'
              ? n < '0012'
              : schema === 'thumbnails'
                ? n < '0015'
                : true),
        )
        .sort())
        sql += await readFile(`migrations/${name}`, 'utf8');
      sql += `INSERT INTO user VALUES('alice','Alice','alice@example.com',1,NULL,1,1);
  INSERT INTO membership(user_id,joined_at) VALUES('alice',1);
  INSERT INTO profile(user_id,handle,display_name,bio,created_at) VALUES('alice','alice','Alice','Bio',1);
  INSERT INTO post(id,user_id,caption,alt_text,created_at,published_at,state,object_key,width,height) VALUES('photo','alice','Caption','Alt',1,1,'published','posts/photo.webp',120,80);`;
      if (thumbnails)
        sql +=
          "UPDATE post SET thumbnail_key='posts/grid.webp' WHERE id='photo';";
      sql +=
        "INSERT INTO avatar(user_id,object_key,width,height) VALUES('alice','avatars/small.webp',120,80);";
      if (largeAvatars)
        sql +=
          "UPDATE avatar SET large_key='avatars/large.webp' WHERE user_id='alice';";
      if (largeAvatars)
        sql += `INSERT INTO invitation(id,inviter_id,recipient_email,created_at,expires_at,join_token_hash,email_payload)
          VALUES('pending-invite','alice','friend@example.com',1,86400000,'${'a'.repeat(64)}','synthetic-encrypted-retry-payload');`;
      if (largeAvatars)
        sql += `INSERT INTO session(id,expiresAt,token,createdAt,updatedAt,userId) VALUES('push-session',9999999999999,'synthetic-token',1,1,'alice');
        INSERT INTO push_subscription VALUES('push','alice','push-session','https://fcm.googleapis.com/synthetic','synthetic-key','synthetic-auth',1);`;
      if (largeAvatars)
        sql += `INSERT INTO invite_link(id,inviter_id,token_hash,token_encrypted,created_at,expires_at) VALUES('shared','alice','hash','synthetic-encrypted-credential',1,9999999999999);
          INSERT INTO invite_link_claim VALUES('claim','claim-invitation','alice','shared','hash','friend@example.com',9999999999999);`;
      const keys = ['posts/photo.webp', 'avatars/small.webp'];
      if (thumbnails) keys.push('posts/grid.webp');
      if (largeAvatars) keys.push('avatars/large.webp');
      const bytes = await readFile('tests/fixtures/photos/still.webp');
      const photos = [];
      for (const photoKey of keys) {
        const filename =
          createHash('sha256').update(photoKey).digest('hex') + '.webp';
        await writeFile(join(dir, 'photos', filename), bytes);
        photos.push({
          key: photoKey,
          filename,
          bytes: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        });
      }
      await writeFile(join(dir, 'database.sql'), sql);
      await writeFile(
        join(dir, 'manifest.json'),
        JSON.stringify({
          version: 1,
          createdAt: new Date().toISOString(),
          databaseSha256: createHash('sha256').update(sql).digest('hex'),
          photos,
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
        photosVerified: keys.length,
        restoredAccess: 'disabled',
        sessionsCleared: true,
        pushSubscriptionsCleared: true,
        invitationCredentialsCleared: true,
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
  },
);
