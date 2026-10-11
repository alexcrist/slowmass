import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';
import { readFile, readdir } from 'node:fs/promises';
import { makeSignature } from 'better-auth/crypto';

const secret = 'test-only-secret-with-at-least-thirty-two-characters';
export async function testRuntime() {
  const result = await build({
    entryPoints: ['src/server/index.ts'],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    target: 'es2022',
    external: ['node:*'],
  });
  const worker = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: result.outputFiles[0].text,
      compatibilityDate: '2026-10-10',
      compatibilityFlags: ['nodejs_compat'],
      d1Databases: ['DB'],
      r2Buckets: ['PHOTOS'],
      bindings: {
        APP_ORIGIN: 'http://localhost:8787',
        AUTH_SECRET: secret,
        RESEND_API_KEY: 'test-key',
        EMAIL_FROM: 'test@example.com',
      },
      outboundService: async () => {
        throw new Error('Network disabled in tests');
      },
    }),
  );
  const db = await worker.getD1Database('DB');
  for (const file of (await readdir('migrations'))
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    await db.batch(
      unstable_splitSqlQuery(await readFile(`migrations/${file}`, 'utf8')).map(
        (sql) => db.prepare(sql),
      ),
    );
  }
  const now = Date.now();
  for (const id of ['alice', 'bob', 'carol', 'david']) {
    await db
      .prepare(
        'INSERT INTO user (id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,1,?,?)',
      )
      .bind(id, id, `${id}@example.com`, now, now)
      .run();
    if (id !== 'alice')
      await db
        .prepare(
          'INSERT INTO invitation (id,inviter_id,recipient_email,created_at,expires_at) VALUES (?, ?, ?, ?, ?)',
        )
        .bind(id, 'alice', `${id}@example.com`, now, now + 86400000)
        .run();
    await db
      .prepare(
        'INSERT INTO membership (user_id,invited_by,invitation_id,joined_at) VALUES (?,?,?,?)',
      )
      .bind(
        id,
        id === 'alice' ? null : 'alice',
        id === 'alice' ? null : id,
        now,
      )
      .run();
    await db
      .prepare(
        'INSERT INTO session (id,userId,token,expiresAt,createdAt,updatedAt) VALUES (?,?,?,?,?,?)',
      )
      .bind(id, id, `${id}-token`, now + 86400000, now, now)
      .run();
  }
  async function request(
    id: string | null,
    path: string,
    method = 'GET',
    body?: unknown,
  ) {
    const headers: Record<string, string> = {
      Origin: 'http://localhost:8787',
      'Content-Type': 'application/json',
    };
    if (id) {
      const token = `${id}-token`;
      headers.Cookie = `better-auth.session_token=${encodeURIComponent(`${token}.${await makeSignature(token, secret)}`)}`;
    }
    return worker.dispatchFetch(`http://localhost:8787${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  return { worker, db, request };
}
