import { build } from 'esbuild';
import {
  Miniflare,
  convertV4MiniflareOptions,
  Response as RuntimeResponse,
} from 'miniflare';
import { unstable_splitSqlQuery, unstable_readConfig } from 'wrangler';
import { readFile, readdir } from 'node:fs/promises';
import { makeSignature } from 'better-auth/crypto';

const secret = 'test-only-secret-with-at-least-thirty-two-characters';
export async function testRuntime(
  maintenance = false,
  images = false,
  mail?: (request: Request) => Promise<{ status: number; body: string }>,
  push?: {
    publicKey: string;
    privateKey: string;
    send: (
      request: Request,
    ) => Promise<{ status: number; headers?: Record<string, string> }>;
  },
  migrationCount?: number,
  google?: (request: Request) => Promise<{ status: number; body: string }>,
) {
  const assetShell = await readFile('index.html', 'utf8');
  const result = await build({
    entryPoints: ['src/server/index.ts'],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    target: 'es2022',
    external: ['node:*'],
    alias: unstable_readConfig({ config: 'wrangler.jsonc' }).alias,
  });
  const worker = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: result.outputFiles[0].text,
      compatibilityDate: '2026-10-10',
      compatibilityFlags: ['nodejs_compat'],
      d1Databases: ['DB'],
      r2Buckets: ['PHOTOS'],
      serviceBindings: {
        ASSETS: async () =>
          new RuntimeResponse(assetShell, {
            headers: {
              'Content-Type': 'text/html; charset=utf-8',
              'Cache-Control': 'public, max-age=3600',
              ETag: '"static-shell"',
            },
          }),
      },
      ...(images ? { images: { binding: 'IMAGES' } } : {}),
      bindings: {
        APP_ORIGIN: 'http://localhost:8787',
        MAINTENANCE_MODE: maintenance ? 'true' : 'false',
        AUTH_SECRET: secret,
        ...(google
          ? {
              GOOGLE_CLIENT_ID: 'synthetic-google-client',
              GOOGLE_CLIENT_SECRET: 'synthetic-google-secret',
            }
          : {}),
        RESEND_API_KEY: 'test-key',
        EMAIL_FROM: 'test@example.com',
        ...(push
          ? {
              PUSH_PUBLIC_KEY: push.publicKey,
              PUSH_PRIVATE_KEY: push.privateKey,
            }
          : {}),
      },
      outboundService: async (request: Request) => {
        if (
          google &&
          [
            'https://oauth2.googleapis.com/token',
            'https://www.googleapis.com/oauth2/v3/certs',
          ].includes(request.url)
        ) {
          const result = await google(request);
          return new RuntimeResponse(result.body, {
            status: result.status,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (push && request.url.startsWith('https://fcm.googleapis.com/')) {
          const result = await push.send(request);
          return new RuntimeResponse(null, {
            status: result.status,
            headers: result.headers,
          });
        }
        if (mail && request.url === 'https://api.resend.com/emails') {
          const result = await mail(request);
          return new RuntimeResponse(result.body, {
            status: result.status,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        throw new Error('Network disabled in tests');
      },
    }),
  );
  const db = await worker.getD1Database('DB');
  for (const file of (await readdir('migrations'))
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .slice(0, migrationCount)) {
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
      .bind(
        id,
        id,
        `${id}-token`,
        new Date(now + 86400000).toISOString(),
        now,
        now,
      )
      .run();
  }
  // These four base fixtures represent existing members, not new join events.
  if (
    (
      await db.prepare('PRAGMA table_info(membership)').all<{ name: string }>()
    ).results.some((column) => column.name === 'join_activity_pending')
  )
    await db.prepare('UPDATE membership SET join_activity_pending=0').run();
  async function request(
    id: string | null,
    path: string,
    method = 'GET',
    body?: unknown,
    extraHeaders: Record<string, string> = {},
    signal?: AbortSignal,
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
      signal,
      headers: { ...headers, ...extraHeaders },
      ...(body === undefined
        ? {}
        : {
            body:
              body instanceof Blob
                ? new Uint8Array(await body.arrayBuffer())
                : JSON.stringify(body),
          }),
    });
  }
  return { worker, db, request };
}

// Completed synthetic members for tests unrelated to onboarding.
export async function seedProfilePhotos(
  db: Awaited<ReturnType<typeof testRuntime>>['db'],
) {
  await db
    .prepare(
      "INSERT OR IGNORE INTO avatar(user_id,object_key,width,height) SELECT user_id,'test-avatar/'||user_id,1,1 FROM profile",
    )
    .run();
}
