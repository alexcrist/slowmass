import { it, expect } from 'vitest';
import {
  mkdtemp,
  readFile,
  writeFile,
  readdir,
  mkdir,
  rm,
  stat,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { encrypt, decrypt } from '../scripts/ops/archive.mjs';
const run = promisify(execFile);
it.each(['legacy', 'thumbnails', 'large avatars', 'events'])(
  'restores encrypted archives with all required photo variants (%s)',
  async (schema) => {
    const thumbnails = schema !== 'legacy';
    const largeAvatars = ['large avatars', 'events'].includes(schema);
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
                : schema === 'large avatars'
                  ? n < '0030'
                  : true),
        )
        .sort())
        sql += await readFile(`migrations/${name}`, 'utf8');
      sql += `INSERT INTO user VALUES('alice','Alice','alice@example.com',1,NULL,1,1);
  INSERT INTO membership(user_id,joined_at) VALUES('alice',1);
  INSERT INTO profile(user_id,handle,display_name,bio,created_at) VALUES('alice','alice','Alice','Bio',1);
  INSERT INTO post(id,user_id,caption,alt_text,created_at,published_at,state,object_key,width,height) VALUES('photo','alice','Caption','Alt',1,1,'published','posts/aa.webp',120,80);`;
      if (thumbnails)
        sql +=
          "UPDATE post SET thumbnail_key='posts/bb.webp' WHERE id='photo';";
      sql +=
        "INSERT INTO avatar(user_id,object_key,width,height) VALUES('alice','avatars/aa.webp',120,80);";
      if (largeAvatars)
        sql +=
          "UPDATE avatar SET large_key='avatars/bb.webp' WHERE user_id='alice';";
      if (largeAvatars)
        sql += `INSERT INTO invitation(id,inviter_id,recipient_email,created_at,expires_at,join_token_hash,email_payload)
          VALUES('pending-invite','alice','friend@example.com',1,86400000,'${'a'.repeat(64)}','synthetic-encrypted-retry-payload');`;
      if (largeAvatars)
        sql += `INSERT INTO session(id,expiresAt,token,createdAt,updatedAt,userId) VALUES('push-session',9999999999999,'synthetic-token',1,1,'alice');
        INSERT INTO push_subscription VALUES('push','alice','push-session','https://fcm.googleapis.com/synthetic','synthetic-key','synthetic-auth',1);`;
      if (largeAvatars)
        sql += `INSERT INTO invite_link(id,inviter_id,token_hash,token_encrypted,created_at,expires_at) VALUES('shared','alice','hash','synthetic-encrypted-credential',1,9999999999999);
          INSERT INTO invite_link_claim VALUES('claim','claim-invitation','alice','shared','hash','friend@example.com',9999999999999);`;
      if (schema === 'events') {
        sql += `
          INSERT INTO event(id,creator_id,title,starts_at,time_zone,state,object_key,thumbnail_key,link_id,link_hash,link_encrypted,created_at)
            VALUES('party','alice','Party',9999999999999,'UTC','published','events/aa.webp','events/bb.webp','link','event-hash','synthetic-encrypted-link',1);
          INSERT INTO event_claim VALUES('event-claim','event-invitation','party','alice','link','event-hash','friend@example.com',9999999999999);`;
        // Past/cancelled covers remain readable; shared sizes are copied once.
        // Pending/deleted event objects belong to cleanup, not recovery media.
        for (const [id, state, startsAt, cancelledAt, objectKey] of [
          ['past', 'published', 1, 'NULL', 'events/cc.webp'],
          ['cancelled', 'published', 9999999999999, 1, 'events/cc.webp'],
          ['draft', 'pending', 9999999999999, 'NULL', 'events/dd.webp'],
          ['deleted', 'deleted', 9999999999999, 'NULL', 'events/ee.webp'],
        ])
          sql += `INSERT INTO event(id,creator_id,title,starts_at,time_zone,state,object_key,thumbnail_key,link_id,link_hash,created_at,cancelled_at)
            VALUES('${id}','alice','Party',${startsAt},'UTC','${state}','${objectKey}','${objectKey}','${id}-link','${id}-hash',1,${cancelledAt});`;
      }
      const keys = ['posts/aa.webp', 'avatars/aa.webp'];
      if (thumbnails) keys.push('posts/bb.webp');
      if (largeAvatars) keys.push('avatars/bb.webp');
      if (schema === 'events')
        keys.push('events/aa.webp', 'events/bb.webp', 'events/cc.webp');
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
      const manifest = {
        version: 1,
        createdAt: new Date().toISOString(),
        databaseSha256: createHash('sha256').update(sql).digest('hex'),
        photos,
      };
      async function pack(name, contents = manifest) {
        await writeFile(join(dir, 'manifest.json'), JSON.stringify(contents));
        await run('tar', [
          '-czf',
          join(dir, 'payload.tar.gz'),
          '-C',
          dir,
          'database.sql',
          'manifest.json',
          'photos',
        ]);
        await encrypt(join(dir, 'payload.tar.gz'), join(dir, name), key);
      }
      const restore = (name) =>
        run(process.execPath, [
          resolve('scripts/ops/restore-check.mjs'),
          join(dir, name),
          join(dir, 'key'),
        ]);
      await pack('backup.enc');
      if (schema === 'events') {
        // Exercise the real exporter, faking only its Cloudflare CLI boundary.
        // The private working directory contains no real Wrangler or credentials.
        const cli = join(dir, 'node_modules/wrangler/bin');
        await mkdir(cli, { recursive: true });
        await writeFile(
          join(cli, 'wrangler.js'),
          `
          const {readFileSync,copyFileSync,appendFileSync} = require('node:fs');
          const {join} = require('node:path');
          const args = process.argv.slice(2);
          if (args[0] === 'd1' && args[1] === 'export') {
            copyFileSync('database.sql', args[args.indexOf('--output') + 1]);
          } else if (args[0] === 'r2' && args[1] === 'object' && args[2] === 'get') {
            const key = args[3].replace(/^slowmass-photos\\//, '');
            const photo = JSON.parse(readFileSync('manifest.json')).photos.find(p => p.key === key);
            if (!photo) throw new Error('Unexpected synthetic object');
            appendFileSync('downloads.jsonl', JSON.stringify(key) + '\\n');
            copyFileSync(join('photos', photo.filename), args[args.indexOf('--file') + 1]);
          } else throw new Error('Unexpected command');
        `,
        );
        const backup = (name) =>
          run(
            process.execPath,
            [
              resolve('scripts/ops/backup.mjs'),
              join(dir, name),
              join(dir, 'key'),
            ],
            { cwd: dir },
          );
        const exported = await backup('exported.enc');
        expect(JSON.parse(exported.stdout)).toMatchObject({
          photos: keys.length,
        });
        expect(
          (await readFile(join(dir, 'downloads.jsonl'), 'utf8'))
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line))
            .sort(),
        ).toEqual([...keys].sort());
        expect(
          JSON.parse((await restore('exported.enc')).stdout),
        ).toMatchObject({
          verified: true,
          photosVerified: keys.length,
        });

        for (const [size, photoKey] of [
          ['cover', 'events/aa.webp'],
          ['thumbnail', 'events/bb.webp'],
        ]) {
          const photo = photos.find((p) => p.key === photoKey);
          const path = join(dir, 'photos', photo.filename);
          await pack(`omitted-${size}.enc`, {
            ...manifest,
            photos: photos.filter((p) => p.key !== photoKey),
          });
          await expect(restore(`omitted-${size}.enc`)).rejects.toThrow(
            'Missing photo manifest entry.',
          );
          await writeFile(path, Buffer.from('damaged synthetic image'));
          await pack(`corrupt-${size}.enc`);
          await expect(restore(`corrupt-${size}.enc`)).rejects.toThrow(
            'Photo checksum mismatch.',
          );
          await rm(path);
          await pack(`missing-${size}.enc`);
          await expect(restore(`missing-${size}.enc`)).rejects.toThrow(
            'ENOENT',
          );
          await expect(backup(`failed-${size}.enc`)).rejects.toThrow(
            'No complete backup created.',
          );
          await expect(
            stat(join(dir, `failed-${size}.enc`)),
          ).rejects.toMatchObject({ code: 'ENOENT' });
          await writeFile(path, bytes);
        }
      }
      const result = await restore('backup.enc');
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
  30000,
);
