import { build } from 'esbuild';
import {
  Miniflare,
  convertV4MiniflareOptions,
  Response as RuntimeResponse,
} from 'miniflare';
import { unstable_splitSqlQuery, unstable_readConfig } from 'wrangler';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { makeSignature } from 'better-auth/crypto';

const secret = 'test-only-secret-with-at-least-thirty-two-characters';
export const sesEndpoint =
  'https://email.us-west-2.amazonaws.com/v2/email/outbound-emails';
export type SentEmail = { to: string[]; text: string };

// Simulated SES boundary: requires a SigV4 signature and decodes the message.
export async function readSesEmail(request: Request): Promise<SentEmail> {
  if (
    !request.headers
      .get('Authorization')
      ?.startsWith('AWS4-HMAC-SHA256 Credential=test-key/')
  )
    throw new Error('Unsigned SES request');
  const body = (await request.json()) as {
    Destination: { ToAddresses: string[] };
    Content: { Simple: { Body: { Text: { Data: string } } } };
  };
  return {
    to: body.Destination.ToAddresses,
    text: body.Content.Simple.Body.Text.Data,
  };
}
type Statement = { sql: string; params: unknown[] };
type D1 = Awaited<ReturnType<Miniflare['getD1Database']>>;

// Every runtime runs the same Worker bundle; build it once per test file.
let bundle: Promise<string> | undefined;
function workerScript() {
  return (bundle ??= build({
    entryPoints: ['src/server/index.ts'],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    target: 'es2022',
    external: ['node:*'],
    alias: unstable_readConfig({ config: 'wrangler.jsonc' }).alias,
  }).then((result) => result.outputFiles[0].text));
}

async function migrationStatements(count?: number) {
  const files = (await readdir('migrations'))
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .slice(0, count);
  return Promise.all(
    files.map(async (file) =>
      unstable_splitSqlQuery(await readFile(`migrations/${file}`, 'utf8')),
    ),
  );
}

// Replaying every migration costs about a second per runtime, so full-schema
// runtimes start from the schema and rows the migrations produce. The capture
// is cached on disk under a hash of the migration files, so editing or adding
// a migration rebuilds it. Tests needing an older schema still replay.
let snapshot: Promise<Statement[]> | undefined;
function migratedSnapshot() {
  return (snapshot ??= (async () => {
    const migrations = await migrationStatements();
    const digest = Buffer.from(
      await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(JSON.stringify(migrations)),
      ),
    ).toString('hex');
    const cache = `node_modules/.cache/slowmass-test-schema/${digest.slice(0, 16)}.json`;
    try {
      return JSON.parse(await readFile(cache, 'utf8')) as Statement[];
    } catch {
      // Not captured yet for this migration set.
    }
    const template = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: 'export default { fetch: () => new Response(null) };',
        compatibilityDate: '2026-10-10',
        d1Databases: ['DB'],
      }),
    );
    try {
      const db = await template.getD1Database('DB');
      for (const statements of migrations)
        await db.batch(statements.map((sql) => db.prepare(sql)));
      const objects = (
        await db
          .prepare(
            "SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY rowid",
          )
          .all<{ type: string; name: string; sql: string }>()
      ).results;
      const tables = objects.filter((object) => object.type === 'table');
      const rows: Statement[] = [];
      for (const table of tables)
        for (const row of (
          await db.prepare(`SELECT * FROM "${table.name}"`).all()
        ).results) {
          const columns = Object.keys(row);
          rows.push({
            sql: `INSERT INTO "${table.name}" (${columns.map((c) => `"${c}"`).join(',')}) VALUES (${columns.map(() => '?').join(',')})`,
            params: Object.values(row),
          });
        }
      // Rows load before indexes, views and triggers so no trigger fires on them.
      const statements: Statement[] = [
        { sql: 'PRAGMA defer_foreign_keys = on', params: [] },
        ...tables.map(({ sql }) => ({ sql, params: [] })),
        ...rows,
        ...objects
          .filter((object) => object.type !== 'table')
          .map(({ sql }) => ({ sql, params: [] })),
      ];
      await mkdir('node_modules/.cache/slowmass-test-schema', {
        recursive: true,
      });
      await writeFile(cache, JSON.stringify(statements));
      return statements;
    } finally {
      await template.dispose();
    }
  })());
}

async function applySchema(db: D1, migrationCount?: number) {
  if (migrationCount === undefined) {
    const statements = await migratedSnapshot();
    await db.batch(
      statements.map(({ sql, params }) => db.prepare(sql).bind(...params)),
    );
    return;
  }
  for (const statements of await migrationStatements(migrationCount))
    await db.batch(statements.map((sql) => db.prepare(sql)));
}

export async function testRuntime(
  maintenance = false,
  images = false,
  mail?: (email: SentEmail) => Promise<{ status: number; body: string }>,
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
  const script = await workerScript();
  const worker = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script,
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
        SES_ACCESS_KEY_ID: 'test-key',
        SES_SECRET_ACCESS_KEY: 'test-secret',
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
        if (mail && request.url === sesEndpoint) {
          const result = await mail(await readSesEmail(request));
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
  await applySchema(db, migrationCount);
  const now = Date.now();
  await db.batch(
    ['alice', 'bob', 'carol', 'david'].flatMap((id) => [
      db
        .prepare(
          'INSERT INTO user (id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,1,?,?)',
        )
        .bind(id, id, `${id}@example.com`, now, now),
      ...(id === 'alice'
        ? []
        : [
            db
              .prepare(
                'INSERT INTO invitation (id,inviter_id,recipient_email,created_at,expires_at) VALUES (?, ?, ?, ?, ?)',
              )
              .bind(id, 'alice', `${id}@example.com`, now, now + 86400000),
          ]),
      db
        .prepare(
          'INSERT INTO membership (user_id,invited_by,invitation_id,joined_at) VALUES (?,?,?,?)',
        )
        .bind(
          id,
          id === 'alice' ? null : 'alice',
          id === 'alice' ? null : id,
          now,
        ),
      db
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
        ),
    ]),
  );
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
