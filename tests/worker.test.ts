import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import {
  Miniflare,
  convertV4MiniflareOptions,
  Response as RuntimeResponse,
} from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';
import { readFile, readdir } from 'node:fs/promises';
import { makeSignature } from 'better-auth/crypto';

const secret = 'test-only-secret-with-at-least-thirty-two-characters';
const origin = 'http://localhost:8787';
const emails: { to: string[]; text: string }[] = [];
let worker: Miniflare;
let unconfigured: Miniflare;
let emailWorker: Miniflare;
let requestNumber = 0;

function requestHeaders(cookie?: string) {
  return {
    Origin: origin,
    'Content-Type': 'application/json',
    'CF-Connecting-IP': `192.0.2.${++requestNumber}`,
    ...(cookie ? { Cookie: cookie } : {}),
  };
}

beforeAll(async () => {
  const result = await build({
    entryPoints: ['src/server/index.ts'],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    target: 'es2022',
    external: ['node:*'],
  });
  const common = {
    modules: true,
    script: result.outputFiles[0].text,
    compatibilityDate: '2026-10-10',
    compatibilityFlags: ['nodejs_compat'],
    d1Databases: ['DB'],
    r2Buckets: ['PHOTOS'],
    outboundService: async (request: Request) => {
      if (request.url !== 'https://api.resend.com/emails')
        throw new Error('Unexpected outbound request in test');
      emails.push((await request.json()) as { to: string[]; text: string });
      return new RuntimeResponse('{"id":"test-message"}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  };
  const bindings = {
    APP_ORIGIN: origin,
    AUTH_SECRET: secret,
    RESEND_API_KEY: 'test-key-never-used-on-network',
    EMAIL_FROM: 'Slowmass <hello@example.com>',
    BOOTSTRAP_EMAIL: 'founder@example.com',
  };
  worker = new Miniflare(convertV4MiniflareOptions({ ...common, bindings }));
  emailWorker = new Miniflare(
    convertV4MiniflareOptions({ ...common, bindings }),
  );
  unconfigured = new Miniflare(
    convertV4MiniflareOptions({ ...common, bindings: { APP_ORIGIN: origin } }),
  );
  const filenames = (await readdir('migrations'))
    .filter((name) => name.endsWith('.sql'))
    .sort();
  for (const instance of [worker, emailWorker]) {
    const db = await instance.getD1Database('DB');
    for (const file of filenames) {
      const statements = unstable_splitSqlQuery(
        await readFile(`migrations/${file}`, 'utf8'),
      );
      await db.batch(statements.map((statement) => db.prepare(statement)));
    }
  }
  const database = await worker.getD1Database('DB');
  const now = Date.now();
  for (const [id, email, expires] of [
    ['friend', 'friend@example.com', now + 86400000],
    ['stranger', 'stranger@example.com', now + 86400000],
    ['expired', 'expired@example.com', now - 1000],
  ] as const) {
    await database
      .prepare(
        'INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)',
      )
      .bind(id, 'Test friend', email, now, now)
      .run();
    await database
      .prepare(
        'INSERT INTO session (id, userId, token, expiresAt, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .bind(id, id, `${id}-token`, expires, now, now)
      .run();
  }
  await database
    .prepare('INSERT INTO membership (user_id, joined_at) VALUES (?, ?)')
    .bind('friend', now)
    .run();
});

afterAll(async () => {
  await Promise.all([
    worker?.dispose(),
    unconfigured?.dispose(),
    emailWorker?.dispose(),
  ]);
});

async function cookieFor(id: string) {
  const token = `${id}-token`;
  return `better-auth.session_token=${encodeURIComponent(`${token}.${await makeSignature(token, secret)}`)}`;
}

async function requestLink(email: string) {
  return emailWorker.dispatchFetch(`${origin}/api/auth/sign-in/magic-link`, {
    method: 'POST',
    headers: requestHeaders(),
    body: JSON.stringify({
      email,
      callbackURL: '/',
      errorCallbackURL: '/?error=signin',
    }),
  });
}

function lastLink(email: string) {
  const delivered = [...emails]
    .reverse()
    .find((message) => message.to.includes(email));
  const url = delivered?.text.match(/https?:\/\/\S+/)?.[0];
  if (!url) throw new Error('No test email delivered');
  return url;
}

function sessionCookie(
  response: Awaited<ReturnType<Miniflare['dispatchFetch']>>,
) {
  const cookie = response.headers
    .getSetCookie()
    .find((value) => value.startsWith('better-auth.session_token='));
  if (!cookie) throw new Error('No session cookie issued');
  return cookie.split(';')[0];
}

describe('Worker authentication boundary', () => {
  it('reports missing setup without exposing config or secrets', async () => {
    const response = await unconfigured.dispatchFetch(`${origin}/api/status`);
    expect(await response.json()).toEqual({ signInAvailable: false });
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  });
  it('fails closed while credentials are missing', async () => {
    expect(
      (await unconfigured.dispatchFetch(`${origin}/api/auth/get-session`))
        .status,
    ).toBe(503);
  });
  it('requires authentication for the account endpoint', async () => {
    expect((await worker.dispatchFetch(`${origin}/api/me`)).status).toBe(401);
  });
  it('reads an active member through a real D1-backed library session', async () => {
    const response = await worker.dispatchFetch(`${origin}/api/me`, {
      headers: requestHeaders(await cookieFor('friend')),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      user: { id: 'friend', name: 'Test friend' },
    });
  });
  it('rejects a valid identity session without membership', async () => {
    expect(
      (
        await worker.dispatchFetch(`${origin}/api/me`, {
          headers: requestHeaders(await cookieFor('stranger')),
        })
      ).status,
    ).toBe(401);
  });
  it('rejects an expired session', async () => {
    expect(
      (
        await worker.dispatchFetch(`${origin}/api/me`, {
          headers: requestHeaders(await cookieFor('expired')),
        })
      ).status,
    ).toBe(401);
  });
  it('rejects forged session signatures', async () => {
    expect(
      (
        await worker.dispatchFetch(`${origin}/api/me`, {
          headers: requestHeaders(
            'better-auth.session_token=friend-token.forged',
          ),
        })
      ).status,
    ).toBe(401);
  });
  it('rejects mutations from a different origin or without an origin', async () => {
    for (const headers of [{ Origin: 'https://evil.example' }, {}]) {
      expect(
        (
          await worker.dispatchFetch(`${origin}/api/auth/sign-out`, {
            method: 'POST',
            headers,
          })
        ).status,
      ).toBe(403);
    }
  });
  it('never serves a guessed private media path', async () => {
    const response = await worker.dispatchFetch(
      `${origin}/media/guess/feed.webp`,
    );
    expect(response.status).toBe(404);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  });
  it('returns API 404s rather than the frontend app', async () => {
    const response = await worker.dispatchFetch(`${origin}/api/missing`);
    expect(response.status).toBe(404);
    expect(response.headers.get('Content-Type')).toContain('application/json');
  });
  it('requires active membership to issue invitations', async () => {
    expect(
      (
        await worker.dispatchFetch(`${origin}/api/invitations`, {
          method: 'POST',
          headers: requestHeaders(await cookieFor('stranger')),
          body: '{"email":"new@example.com"}',
        })
      ).status,
    ).toBe(401);
  });
  it('invalidates a session on sign-out', async () => {
    const cookie = await cookieFor('friend');
    const response = await worker.dispatchFetch(`${origin}/api/auth/sign-out`, {
      method: 'POST',
      headers: requestHeaders(cookie),
      body: '{}',
    });
    expect(response.status).toBe(200);
    expect(
      (
        await worker.dispatchFetch(`${origin}/api/me`, {
          headers: requestHeaders(cookie),
        })
      ).status,
    ).toBe(401);
  });
});

describe('verified email and permanent invitation provenance', () => {
  let founderCookie: string;
  let founderId: string;
  let friendId: string;
  let friendCookie: string;
  it('returns generic success without sending mail to uninvited addresses', async () => {
    const count = emails.length;
    expect((await requestLink('uninvited@example.com')).status).toBe(200);
    expect(emails).toHaveLength(count);
  });
  it('creates only the configured first member after email verification', async () => {
    expect((await requestLink('founder@example.com')).status).toBe(200);
    const db = await emailWorker.getD1Database('DB');
    expect(await db.prepare('SELECT 1 FROM membership').first()).toBeNull();
    const response = await emailWorker.dispatchFetch(
      lastLink('founder@example.com'),
      { redirect: 'manual', headers: requestHeaders() },
    );
    expect(response.status).toBe(302);
    founderCookie = sessionCookie(response);
    const member = await db
      .prepare('SELECT user_id, invited_by FROM membership')
      .first<{ user_id: string; invited_by: string | null }>();
    expect(member?.invited_by).toBeNull();
    founderId = member!.user_id;
    expect(
      (
        await db
          .prepare('SELECT emailVerified FROM user WHERE id = ?')
          .bind(founderId)
          .first<{ emailVerified: number }>()
      )?.emailVerified,
    ).toBe(1);
  });
  it('consumes each email link once', async () => {
    const response = await emailWorker.dispatchFetch(
      lastLink('founder@example.com'),
      { redirect: 'manual', headers: requestHeaders() },
    );
    expect(response.headers.get('location')).toContain('error=');
    expect(
      response.headers
        .getSetCookie()
        .some(
          (cookie) =>
            cookie.startsWith('better-auth.session_token=') &&
            !cookie.startsWith('better-auth.session_token=;'),
        ),
    ).toBe(false);
  });
  it('lets an active member invite a specific email, without duplicate invitations', async () => {
    const options = {
      method: 'POST',
      headers: requestHeaders(founderCookie),
      body: '{"email":"Friend@Example.com"}',
    };
    expect(
      (await emailWorker.dispatchFetch(`${origin}/api/invitations`, options))
        .status,
    ).toBe(201);
    expect(
      (await emailWorker.dispatchFetch(`${origin}/api/invitations`, options))
        .status,
    ).toBe(409);
  });
  it('atomically joins the invited member and records who invited whom', async () => {
    expect((await requestLink('friend@example.com')).status).toBe(200);
    const response = await emailWorker.dispatchFetch(
      lastLink('friend@example.com'),
      { redirect: 'manual', headers: requestHeaders() },
    );
    expect(response.status).toBe(302);
    friendCookie = sessionCookie(response);
    const db = await emailWorker.getD1Database('DB');
    const row = await db
      .prepare(
        'SELECT m.user_id, m.invited_by, i.accepted_by FROM membership m JOIN invitation i ON i.id = m.invitation_id',
      )
      .first<{ user_id: string; invited_by: string; accepted_by: string }>();
    expect(row?.invited_by).toBe(founderId);
    expect(row?.accepted_by).toBe(row?.user_id);
    friendId = row!.user_id;
    expect(
      (
        await emailWorker.dispatchFetch(`${origin}/api/me`, {
          headers: requestHeaders(friendCookie),
        })
      ).status,
    ).toBe(200);
  });
  it('prevents rewriting invitation attribution', async () => {
    const db = await emailWorker.getD1Database('DB');
    await expect(
      db
        .prepare(
          'UPDATE membership SET invited_by = NULL, invitation_id = NULL WHERE user_id = ?',
        )
        .bind(friendId)
        .run(),
    ).rejects.toThrow();
    await expect(
      db
        .prepare('UPDATE invitation SET inviter_id = ? WHERE accepted_by = ?')
        .bind(friendId, friendId)
        .run(),
    ).rejects.toThrow();
  });
  it('retains immutable invitation and join timestamps for incident review', async () => {
    const db = await emailWorker.getD1Database('DB');
    const row = await db
      .prepare(
        'SELECT i.created_at, m.joined_at FROM invitation i JOIN membership m ON m.invitation_id = i.id WHERE m.user_id = ?',
      )
      .bind(friendId)
      .first<{ created_at: number; joined_at: number }>();
    expect(row?.created_at).toBeGreaterThan(0);
    expect(row!.joined_at).toBeGreaterThanOrEqual(row!.created_at);
    await expect(
      db
        .prepare(
          'UPDATE invitation SET created_at = created_at - 1 WHERE accepted_by = ?',
        )
        .bind(friendId)
        .run(),
    ).rejects.toThrow();
    await expect(
      db
        .prepare(
          'UPDATE membership SET joined_at = joined_at - 1 WHERE user_id = ?',
        )
        .bind(friendId)
        .run(),
    ).rejects.toThrow();
  });
  it('rejects a join if the inviter is disabled after a link was sent', async () => {
    expect(
      (
        await emailWorker.dispatchFetch(`${origin}/api/invitations`, {
          method: 'POST',
          headers: requestHeaders(friendCookie),
          body: '{"email":"next@example.com"}',
        })
      ).status,
    ).toBe(201);
    expect((await requestLink('next@example.com')).status).toBe(200);
    const db = await emailWorker.getD1Database('DB');
    await db
      .prepare("UPDATE membership SET status = 'disabled' WHERE user_id = ?")
      .bind(friendId)
      .run();
    const response = await emailWorker.dispatchFetch(
      lastLink('next@example.com'),
      { redirect: 'manual', headers: requestHeaders() },
    );
    expect(response.headers.get('location')).toContain('error=');
    expect(
      await db
        .prepare("SELECT 1 FROM user WHERE email = 'next@example.com'")
        .first(),
    ).toBeNull();
    expect(
      (
        await emailWorker.dispatchFetch(`${origin}/api/invitations`, {
          method: 'POST',
          headers: requestHeaders(friendCookie),
          body: '{"email":"another@example.com"}',
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await emailWorker.dispatchFetch(`${origin}/api/me`, {
          headers: requestHeaders(friendCookie),
        })
      ).status,
    ).toBe(401);
  });
  it('allows an existing member to sign in without another invitation', async () => {
    expect((await requestLink('founder@example.com')).status).toBe(200);
    const response = await emailWorker.dispatchFetch(
      lastLink('founder@example.com'),
      { redirect: 'manual', headers: requestHeaders() },
    );
    expect(response.status).toBe(302);
    expect(sessionCookie(response)).toContain('better-auth.session_token=');
    const db = await emailWorker.getD1Database('DB');
    expect(
      (
        await db
          .prepare('SELECT COUNT(*) AS count FROM membership WHERE user_id = ?')
          .bind(founderId)
          .first<{ count: number }>()
      )?.count,
    ).toBe(1);
  });
  it('does not send a join link for an expired invitation', async () => {
    const db = await emailWorker.getD1Database('DB');
    const now = Date.now();
    await db
      .prepare(
        'INSERT INTO invitation (id, inviter_id, recipient_email, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(
        'expired-invitation',
        founderId,
        'late@example.com',
        now - 10000,
        now - 1,
      )
      .run();
    const count = emails.length;
    expect((await requestLink('late@example.com')).status).toBe(200);
    expect(emails).toHaveLength(count);
  });
  it('enforces the single-root database constraint', async () => {
    const db = await emailWorker.getD1Database('DB');
    await db
      .prepare(
        'INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)',
      )
      .bind(
        'second-root',
        '',
        'second-root@example.com',
        Date.now(),
        Date.now(),
      )
      .run();
    await expect(
      db
        .prepare('INSERT INTO membership (user_id, joined_at) VALUES (?, ?)')
        .bind('second-root', Date.now())
        .run(),
    ).rejects.toThrow();
  });
  it('stops email delivery when the daily budget is exhausted', async () => {
    const db = await emailWorker.getD1Database('DB');
    await db
      .prepare('UPDATE email_budget SET used = 80 WHERE budget_key = ?')
      .bind(`day:${Math.floor(Date.now() / 86400000)}`)
      .run();
    const count = emails.length;
    expect((await requestLink('founder@example.com')).status).toBe(200);
    expect(emails).toHaveLength(count);
  });
  it('retains the invitation tree when a member is disabled', async () => {
    const db = await emailWorker.getD1Database('DB');
    const row = await db
      .prepare('SELECT invited_by FROM membership WHERE user_id = ?')
      .bind(friendId)
      .first<{ invited_by: string }>();
    expect(row?.invited_by).toBe(founderId);
  });
});
