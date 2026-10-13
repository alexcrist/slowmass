import { afterEach, beforeEach, expect, it } from 'vitest';
import { testRuntime, seedProfilePhotos } from './support/runtime';
import {
  bindSharedVerification,
  acceptSharedVerification,
} from '../src/server/membership';
import {
  cleanupInviteLinks,
  invitationPage,
} from '../src/server/features/invitations';
import {
  emptyMetrics,
  measuredDatabase,
  requestMetrics,
} from '../src/server/telemetry';

let runtime: Awaited<ReturnType<typeof testRuntime>>;
let sent: { to: string[]; text: string }[];
let ip = 0;
beforeEach(async () => {
  sent = [];
  runtime = await testRuntime(false, false, async (request) => {
    sent.push((await request.json()) as (typeof sent)[number]);
    return { status: 200, body: '{"id":"synthetic"}' };
  });
  for (const id of ['alice', 'bob'])
    await runtime.request(id, '/api/people/self', 'PUT', {
      handle: id,
      displayName: id,
      bio: '',
    });
  await seedProfilePhotos(runtime.db);
  await runtime.db.prepare('DELETE FROM follow').run();
});
afterEach(async () => {
  await runtime?.worker.dispose();
});
async function create(actor = 'alice') {
  const request = { id: crypto.randomUUID() };
  const response = await runtime.request(
    actor,
    '/api/invite-link/copy',
    'POST',
    request,
  );
  expect(response.status).toBe(200);
  const link = (await response.json()) as {
    id: string;
    url: string;
    expiresAt: number;
  };
  return { ...link, token: new URL(link.url).hash.slice(1), request };
}
async function requestEmail(token: string, email: string) {
  return runtime.request(
    null,
    '/api/auth/sign-in/magic-link',
    'POST',
    {
      email,
      callbackURL: '/',
      errorCallbackURL: '/?error=invite',
      metadata: { inviteLink: token },
    },
    { 'CF-Connecting-IP': `192.0.2.${++ip}` },
  );
}
async function verify(message = sent.at(-1)!) {
  const url = new URL(message.text.match(/https?:\/\/\S+/)![0]);
  return runtime.worker.dispatchFetch(url.toString(), {
    headers: { 'CF-Connecting-IP': `192.0.2.${++ip}` },
    redirect: 'manual',
  });
}
async function member(email: string) {
  return runtime.db
    .prepare(
      'SELECT u.id,m.invited_by AS inviter,m.invitation_id AS invitation FROM user u JOIN membership m ON m.user_id=u.id WHERE u.email=?',
    )
    .bind(email)
    .first<{ id: string; inviter: string; invitation: string }>();
}
async function sharedJoins() {
  return runtime.db
    .prepare(
      "SELECT COUNT(*) AS n FROM invitation WHERE kind='shared' AND inviter_id='alice' AND accepted_by IS NOT NULL",
    )
    .first<number>('n');
}
async function replace(id: string, newId: string = crypto.randomUUID()) {
  const response = await runtime.request(
    'alice',
    '/api/invite-link/replace',
    'POST',
    { id: newId, expectedId: id },
  );
  expect(response.status).toBe(200);
  const link = (await response.json()) as {
    id: string;
    url: string;
    expiresAt: number;
  };
  return { ...link, token: new URL(link.url).hash.slice(1) };
}
it('reuses the current owner-only link, previews safely, and admits only verified new members', async () => {
  const link = await create();
  expect(new URL(link.url).pathname).toBe('/invite');
  expect(new URL(link.url).search).toBe('');
  const retry = await runtime.request(
    'alice',
    '/api/invite-link/copy',
    'POST',
    link.request,
  );
  expect(await retry.json()).toEqual({
    id: link.id,
    url: link.url,
    expiresAt: link.expiresAt,
  });
  expect(
    await (await runtime.request('bob', '/api/invite-link')).json(),
  ).toEqual({ link: null });
  expect(
    (
      await runtime.request('bob', '/api/invite-link/replace', 'POST', {
        id: crypto.randomUUID(),
        expectedId: link.id,
      })
    ).status,
  ).toBe(409);
  expect(
    await (
      await runtime.request(
        null,
        '/api/auth/shared-invitation/preview',
        'POST',
        { token: link.token },
      )
    ).json(),
  ).toMatchObject({
    status: 'ready',
    inviter: { name: 'alice', handle: 'alice' },
    signedIn: false,
  });
  expect(await sharedJoins()).toBe(0);
  expect((await requestEmail(link.token, 'new@example.com')).status).toBe(200);
  expect(await sharedJoins()).toBe(0);
  expect(await member('new@example.com')).toBeNull();
  expect(
    (await verify()).headers
      .getSetCookie()
      .some((value) => value.includes('session_token=')),
  ).toBe(true);
  expect(await sharedJoins()).toBe(1);
  expect((await member('new@example.com'))?.inviter).toBe('alice');
  await verify();
  expect(await sharedJoins()).toBe(1);
  const secret = await runtime.db
    .prepare('SELECT token_hash,token_encrypted FROM invite_link WHERE id=?')
    .bind(link.id)
    .first();
  expect(JSON.stringify(secret)).not.toContain(link.token);
  expect(
    JSON.stringify(
      await (await runtime.request('alice', '/api/invitations')).json(),
    ),
  ).not.toContain('new@example.com');
  expect(
    (await runtime.request('alice', `/api/invite-links/${link.id}/members`))
      .status,
  ).toBe(404);
});

it('reports one owner-only link with fixed seven-day expiry and no capacity fields', async () => {
  const before = Date.now();
  const link = await create();
  const metadata = await (
    await runtime.request('alice', '/api/invite-link')
  ).json();
  expect(metadata).toEqual({
    link: { id: link.id, expiresAt: link.expiresAt, available: true },
  });
  expect(link.expiresAt).toBeGreaterThanOrEqual(before + 7 * 86400000);
  expect(link.expiresAt).toBeLessThanOrEqual(Date.now() + 7 * 86400000);
  expect(JSON.stringify(metadata)).not.toContain(link.token);
  for (const extra of [{ name: 'Friends' }, { maxUses: 100 }])
    expect(
      (
        await runtime.request('alice', '/api/invite-link/copy', 'POST', {
          id: crypto.randomUUID(),
          ...extra,
        })
      ).status,
    ).toBe(400);
  expect(await sharedJoins()).toBe(0);
});

it('does not auto-follow shared invitees and announces profile completion once with private avatar access', async () => {
  const link = await create();
  await requestEmail(link.token, 'new@example.com');
  const verified = await verify();
  const cookie = verified.headers
    .getSetCookie()
    .find((value) => value.startsWith('better-auth.session_token='))!
    .split(';')[0];
  const joined = (await member('new@example.com'))!;
  expect(
    (
      await runtime.request(
        null,
        '/api/people/self',
        'PUT',
        { handle: 'newfriend', displayName: 'Friend', bio: '' },
        { Cookie: cookie },
      )
    ).status,
  ).toBe(200);
  expect(
    (await runtime.db.prepare('SELECT * FROM follow').all()).results,
  ).toHaveLength(0);
  const before = await runtime.request(
    'alice',
    '/api/notifications?includeJoined=1',
  );
  expect(((await before.json()) as { items: unknown[] }).items).toEqual([]);
  await seedProfilePhotos(runtime.db);
  const response = await runtime.request(
    'alice',
    '/api/notifications?includeJoined=1',
  );
  const page = (await response.json()) as {
    items: { key: string; kind: string; handle: string; version: number }[];
  };
  expect(page.items).toHaveLength(1);
  expect(page.items[0]).toMatchObject({
    key: `joined:${joined.id}`,
    kind: 'joined',
    handle: 'newfriend',
  });
  expect((await runtime.request(null, '/media/avatar/newfriend')).status).toBe(
    404,
  );
  expect((await runtime.request('alice', '/api/people/newfriend')).status).toBe(
    200,
  );
  const posts = await runtime.request('alice', '/api/posts?handle=newfriend');
  expect(posts.status).toBe(404);
  await runtime.db
    .prepare('UPDATE avatar SET width=2 WHERE user_id=?')
    .bind(joined.id)
    .run();
  expect(
    (
      await runtime.request('alice', '/api/notifications/read', 'POST', {
        items: [{ key: page.items[0].key, version: page.items[0].version }],
      })
    ).status,
  ).toBe(200);
  expect(
    await (
      await runtime.request(
        'alice',
        '/api/notifications/unread-count?includeJoined=1',
      )
    ).json(),
  ).toEqual({ count: 0 });
  await runtime.db
    .prepare('DELETE FROM avatar WHERE user_id=?')
    .bind(joined.id)
    .run();
  await seedProfilePhotos(runtime.db);
  expect(
    await (
      await runtime.request(
        'alice',
        '/api/notifications/unread-count?includeJoined=1',
      )
    ).json(),
  ).toEqual({ count: 0 });
  await runtime.request('alice', '/api/people/newfriend/block', 'POST');
  expect(
    (
      (await (
        await runtime.request('alice', '/api/notifications?includeJoined=1')
      ).json()) as {
        items: unknown[];
      }
    ).items,
  ).toEqual([]);
});
it.each([
  'replaced',
  'link expired',
  'claim expired',
  'inactive',
  'missing photo',
])(
  'rechecks %s at verification and never falls back to another personal invitation',
  async (reason) => {
    const link = await create();
    await requestEmail(link.token, 'new@example.com');
    const message = sent.at(-1)!;
    await runtime.request('bob', '/api/invitations', 'POST', {
      email: 'new@example.com',
    });
    if (reason === 'replaced') await replace(link.id);
    if (reason === 'link expired') {
      await runtime.db
        .prepare('UPDATE invite_link SET created_at=?,expires_at=?')
        .bind(Date.now() - 8 * 86400000, Date.now() - 1)
        .run();
      // Retain the failed claim until the email token expires, preventing fallback.
      await cleanupInviteLinks(runtime.db as unknown as D1Database);
    }
    if (reason === 'claim expired')
      await runtime.db
        .prepare('UPDATE invite_link_claim SET expires_at=?')
        .bind(Date.now() - 1)
        .run();
    if (reason === 'inactive')
      await runtime.db
        .prepare(
          "UPDATE membership SET status='disabled' WHERE user_id='alice'",
        )
        .run();
    if (reason === 'missing photo')
      await runtime.db
        .prepare("DELETE FROM avatar WHERE user_id='alice'")
        .run();
    expect(
      (await verify(message)).headers
        .getSetCookie()
        .some((value) => value.includes('session_token=')),
    ).toBe(false);
    expect(await member('new@example.com')).toBeNull();
  },
);

it('existing members sign in without creating another invitation or changing attribution', async () => {
  const link = await create();
  const before = await member('bob@example.com');
  expect((await requestEmail(link.token, 'bob@example.com')).status).toBe(200);
  expect(
    (await verify()).headers
      .getSetCookie()
      .some((value) => value.includes('session_token=')),
  ).toBe(true);
  expect(await sharedJoins()).toBe(0);
  expect(await member('bob@example.com')).toEqual(before);
});
it('admits more than 100 verified members concurrently and preserves provenance after replacement and deletion', async () => {
  const link = await create();
  const db = runtime.db as unknown as D1Database;
  const ids = Array.from({ length: 101 }, (_, index) => `verified-${index}`);
  const now = Date.now();
  await runtime.db.batch(
    ids.map((id) =>
      runtime.db
        .prepare(
          'INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,1,?,?)',
        )
        .bind(id, id, `${id}@example.com`, now, now),
    ),
  );
  expect(
    (
      await Promise.all(
        ids.map((id) =>
          bindSharedVerification(db, link.token, `${id}@example.com`, id),
        ),
      )
    ).every(Boolean),
  ).toBe(true);
  expect(
    (
      await Promise.all(ids.map((id) => acceptSharedVerification(db, id, id)))
    ).every(Boolean),
  ).toBe(true);
  expect(await sharedJoins()).toBe(101);
  const metrics = emptyMetrics();
  const personal = await requestMetrics.run(metrics, () =>
    invitationPage(
      measuredDatabase(db),
      'alice',
      Date.now() + 1,
      '',
      Date.now(),
    ),
  );
  expect(personal.items).toHaveLength(3);
  expect(metrics.rowsRead).toBeLessThan(30);
  await acceptSharedVerification(db, ids[0], ids[0]);
  expect(await sharedJoins()).toBe(101);
  const before = await member(`${ids[0]}@example.com`);
  await replace(link.id);
  expect(await member(`${ids[0]}@example.com`)).toEqual(before);
  await runtime.db
    .prepare("UPDATE membership SET status='deleted' WHERE user_id=?")
    .bind(ids[0])
    .run();
  expect(await sharedJoins()).toBe(101);
  expect(
    (await runtime.db.prepare('SELECT * FROM invite_link').all()).results,
  ).toHaveLength(1);
  expect(
    (await runtime.db.prepare('PRAGMA foreign_key_check').all()).results,
  ).toEqual([]);
});

it('enforces ownership, complete profiles, expired sessions, origins, and input bounds', async () => {
  const link = await create();
  expect((await runtime.request(null, '/api/invite-link')).status).toBe(401);
  expect((await runtime.request('carol', '/api/invite-link')).status).toBe(409);
  expect(
    (
      await runtime.request('alice', '/api/invite-link/copy', 'POST', {
        id: crypto.randomUUID(),
        maxUses: 101,
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await runtime.request(
        'alice',
        '/api/invite-link/copy',
        'POST',
        { id: crypto.randomUUID() },
        { Origin: 'https://elsewhere.test' },
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await runtime.request('bob', '/api/invite-link/replace', 'POST', {
        id: crypto.randomUUID(),
        expectedId: link.id,
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await runtime.request('alice', '/api/invite-link/replace', 'POST', {
        id: link.id,
        expectedId: link.id,
      })
    ).status,
  ).toBe(400);
  const original = await (
    await runtime.request('alice', '/api/invite-link')
  ).json();
  await runtime.db
    .prepare("UPDATE session SET expiresAt=1 WHERE userId='alice'")
    .run();
  expect(
    (
      await runtime.request('alice', '/api/invite-link/copy', 'POST', {
        id: crypto.randomUUID(),
      })
    ).status,
  ).toBe(401);
  expect(original).toMatchObject({ link: { id: link.id } });
});

it('also announces personal email invitees once, while retaining their mutual follows', async () => {
  await runtime.request('alice', '/api/invitations', 'POST', {
    email: 'personal@example.com',
  });
  const token = new URL(
    sent.at(-1)!.text.match(/https?:\/\/\S+/)![0],
  ).hash.slice(1);
  const response = await runtime.request(
    null,
    '/api/auth/invitation/accept',
    'POST',
    { token },
    { 'CF-Connecting-IP': `192.0.2.${++ip}` },
  );
  expect(response.status).toBe(200);
  const cookie = response.headers
    .getSetCookie()
    .find((value) => value.startsWith('better-auth.session_token='))!
    .split(';')[0];
  await runtime.request(
    null,
    '/api/people/self',
    'PUT',
    { handle: 'personal', displayName: 'Personal', bio: '' },
    { Cookie: cookie },
  );
  await seedProfilePhotos(runtime.db);
  const items = (
    (await (
      await runtime.request('alice', '/api/notifications?includeJoined=1')
    ).json()) as {
      items: { kind: string; handle: string }[];
    }
  ).items;
  expect(items.filter((item) => item.kind === 'joined')).toEqual([
    expect.objectContaining({ handle: 'personal' }),
  ]);
  expect(items.filter((item) => item.kind === 'follower')).toHaveLength(1);
  await runtime.request(
    null,
    '/api/people/self',
    'PUT',
    { handle: 'personal', displayName: 'Changed', bio: '' },
    { Cookie: cookie },
  );
  expect(
    (
      await runtime.db
        .prepare("SELECT * FROM activity_source WHERE kind='joined'")
        .all()
    ).results,
  ).toHaveLength(1);
});

it('converges concurrent copies on one credential without extending expiry', async () => {
  const responses = await Promise.all(
    Array.from({ length: 6 }, () =>
      runtime.request('alice', '/api/invite-link/copy', 'POST', {
        id: crypto.randomUUID(),
      }),
    ),
  );
  const links = await Promise.all(
    responses.map(async (response) => {
      expect(response.status).toBe(200);
      return response.json();
    }),
  );
  expect(
    links.every((link) => JSON.stringify(link) === JSON.stringify(links[0])),
  ).toBe(true);
  expect(
    (await runtime.db.prepare('SELECT * FROM invite_link').all()).results,
  ).toHaveLength(1);
  expect(
    await (
      await runtime.request('alice', '/api/invite-link/copy', 'POST', {
        id: crypto.randomUUID(),
      })
    ).json(),
  ).toEqual(links[0]);
});

it('creates a fresh credential after expiry without accumulating records', async () => {
  const link = await create();
  await runtime.db
    .prepare('UPDATE invite_link SET created_at=?,expires_at=?')
    .bind(Date.now() - 8 * 86400000, Date.now() - 1)
    .run();
  const fresh = await create();
  expect(fresh.url).not.toBe(link.url);
  expect(fresh.id).not.toBe(link.id);
  expect(
    (await runtime.db.prepare('SELECT * FROM invite_link').all()).results,
  ).toHaveLength(1);
  expect(
    await (
      await runtime.request(
        null,
        '/api/auth/shared-invitation/preview',
        'POST',
        { token: link.token },
      )
    ).json(),
  ).toEqual({ status: 'unavailable' });
});

it('retries replacement safely and rejects stale replacements after a newer version', async () => {
  const link = await create();
  const request = { id: crypto.randomUUID(), expectedId: link.id };
  const responses = await Promise.all(
    [1, 2].map(() =>
      runtime.request('alice', '/api/invite-link/replace', 'POST', request),
    ),
  );
  const results = await Promise.all(
    responses.map(async (response) => {
      expect(response.status).toBe(200);
      return response.json() as Promise<{ id: string; url: string }>;
    }),
  );
  expect(results[0]).toEqual(results[1]);
  await replace(results[0].id);
  expect(
    (
      await runtime.request(
        'alice',
        '/api/invite-link/replace',
        'POST',
        request,
      )
    ).status,
  ).toBe(409);
});

it('allows only one of two competing replacements to win', async () => {
  const link = await create();
  const responses = await Promise.all(
    [1, 2].map(() =>
      runtime.request('alice', '/api/invite-link/replace', 'POST', {
        id: crypto.randomUUID(),
        expectedId: link.id,
      }),
    ),
  );
  expect(responses.map((response) => response.status).sort()).toEqual([
    200, 409,
  ]);
  expect(
    (await runtime.db.prepare('SELECT * FROM invite_link').all()).results,
  ).toHaveLength(1);
});

it('never revives old verification emails even if a caller reuses a previous version ID', async () => {
  const link = await create();
  await requestEmail(link.token, 'new@example.com');
  const message = sent.at(-1)!;
  const next = await replace(link.id);
  const reused = await replace(next.id, link.id);
  expect(reused.url).not.toBe(link.url);
  expect(
    (await verify(message)).headers
      .getSetCookie()
      .some((value) => value.includes('session_token=')),
  ).toBe(false);
  expect(await member('new@example.com')).toBeNull();
});

it('retains provenance but clears shared credentials and recipient claims during deletion', async () => {
  const link = await create();
  await requestEmail(link.token, 'bob@example.com');
  // A pending claim for a not-yet-joined recipient is never exposed to the owner.
  await requestEmail(link.token, 'pending@example.com');
  expect(
    (
      await runtime.request('alice', '/api/me', 'DELETE', {
        confirmation: 'DELETE',
      })
    ).status,
  ).toBe(200);
  const { cleanupAccounts } = await import('../src/server/features/account');
  await cleanupAccounts(runtime.db as unknown as D1Database);
  expect(
    await runtime.db
      .prepare('SELECT token_encrypted,revoked_at FROM invite_link WHERE id=?')
      .bind(link.id)
      .first(),
  ).toMatchObject({
    token_encrypted: null,
    revoked_at: expect.any(Number),
  });
  expect(
    (
      await runtime.request(
        null,
        '/api/auth/shared-invitation/preview',
        'POST',
        { token: link.token },
      )
    ).status,
  ).toBe(200);
  expect(await member('alice@example.com')).toBeNull();
  expect(
    await runtime.db
      .prepare('SELECT 1 FROM invite_link WHERE id=?')
      .bind(link.id)
      .first(),
  ).not.toBeNull();
});

it.each(['personal', 'shared'])(
  'resumes unfinished onboarding after %s joining, session loss and inviter deactivation',
  async (kind) => {
    const email = 'returning@example.com';
    let response: Awaited<ReturnType<typeof verify>>;
    let sharedId: string | undefined;
    if (kind === 'shared') {
      const link = await create();
      sharedId = link.id;
      await requestEmail(link.token, email);
      response = await verify();
      await replace(link.id);
    } else {
      await runtime.request('alice', '/api/invitations', 'POST', { email });
      const token = new URL(
        sent.at(-1)!.text.match(/https?:\/\/\S+/)![0],
      ).hash.slice(1);
      response = await runtime.request(
        null,
        '/api/auth/invitation/accept',
        'POST',
        { token },
        { 'CF-Connecting-IP': `192.0.2.${++ip}` },
      );
      expect(response.status).toBe(200);
    }
    const sessionCookie = (result: Awaited<ReturnType<typeof verify>>) => {
      const cookie = result.headers
        .getSetCookie()
        .find((value) => value.startsWith('better-auth.session_token='));
      expect(cookie).toBeDefined();
      return cookie!.split(';')[0];
    };
    let cookie = sessionCookie(response);
    const original = (await member(email))!;
    expect(original).toBeTruthy();
    const bootstrap = async () =>
      (await (
        await runtime.request(null, '/api/bootstrap', 'GET', undefined, {
          Cookie: cookie,
        })
      ).json()) as {
        user: { id: string } | null;
        profile: { handle: string; hasAvatar: number } | null;
      };
    expect(await bootstrap()).toMatchObject({
      user: { id: original.id },
      profile: null,
    });
    await runtime.db
      .prepare("UPDATE membership SET status='disabled' WHERE user_id='alice'")
      .run();
    for (const savedProfile of [false, true]) {
      if (savedProfile) {
        expect(
          (
            await runtime.request(
              null,
              '/api/people/self',
              'PUT',
              { handle: 'returning', displayName: 'Returning', bio: '' },
              { Cookie: cookie },
            )
          ).status,
        ).toBe(200);
      }
      await runtime.db
        .prepare('DELETE FROM session WHERE userId=?')
        .bind(original.id)
        .run();
      expect(await bootstrap()).toMatchObject({ user: null, profile: null });
      const login = await runtime.request(
        null,
        '/api/auth/sign-in/magic-link',
        'POST',
        { email, callbackURL: '/' },
        { 'CF-Connecting-IP': `192.0.2.${++ip}` },
      );
      expect(login.status).toBe(200);
      cookie = sessionCookie(await verify());
      const state = await bootstrap();
      expect(state.user?.id).toBe(original.id);
      if (savedProfile)
        expect(state.profile).toMatchObject({
          handle: 'returning',
          hasAvatar: 0,
        });
      else expect(state.profile).toBeNull();
      expect(await member(email)).toEqual(original);
      for (const path of [
        '/api/posts',
        '/api/people',
        '/api/notifications',
        '/api/invite-link',
      ]) {
        expect(
          (
            await runtime.request(null, path, 'GET', undefined, {
              Cookie: cookie,
            })
          ).status,
        ).toBe(409);
      }
      if (sharedId) expect(await sharedJoins()).toBe(1);
    }
    await seedProfilePhotos(runtime.db);
    expect((await bootstrap()).profile).toMatchObject({
      handle: 'returning',
      hasAvatar: 1,
    });
    expect(
      (
        await runtime.request(null, '/api/posts', 'GET', undefined, {
          Cookie: cookie,
        })
      ).status,
    ).toBe(200);
  },
);

it('atomically preserves one inviter when two verified links race for the same member', async () => {
  const alice = await create();
  const bob = await create('bob');
  const db = runtime.db as unknown as D1Database;
  const now = Date.now();
  await runtime.db
    .prepare(
      "INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES('racer','Racer','racer@example.com',1,?,?)",
    )
    .bind(now, now)
    .run();
  await bindSharedVerification(
    db,
    alice.token,
    'racer@example.com',
    'alice-verification',
  );
  await bindSharedVerification(
    db,
    bob.token,
    'racer@example.com',
    'bob-verification',
  );
  await Promise.all(
    ['alice-verification', 'bob-verification'].map((token) =>
      acceptSharedVerification(db, 'racer', token),
    ),
  );
  const joined = (await member('racer@example.com'))!;
  expect(['alice', 'bob']).toContain(joined.inviter);
  expect(
    (
      await runtime.db
        .prepare(
          "SELECT * FROM invitation WHERE recipient_email='racer@example.com' AND accepted_by IS NOT NULL",
        )
        .all()
    ).results,
  ).toHaveLength(1);
  expect(
    await runtime.db
      .prepare('SELECT inviter_id,kind FROM invitation WHERE id=?')
      .bind(joined.invitation)
      .first(),
  ).toEqual({ inviter_id: joined.inviter, kind: 'shared' });
});

it('rolls back a failed membership insertion and permits a retry without orphan redemptions', async () => {
  const link = await create();
  const db = runtime.db as unknown as D1Database;
  const now = Date.now();
  await runtime.db
    .prepare(
      "INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES('retry','Retry','retry@example.com',1,?,?)",
    )
    .bind(now, now)
    .run();
  await bindSharedVerification(
    db,
    link.token,
    'retry@example.com',
    'retry-verification',
  );
  await runtime.db
    .prepare(
      "CREATE TRIGGER fail_shared BEFORE INSERT ON membership WHEN NEW.user_id='retry' BEGIN SELECT RAISE(ABORT,'synthetic'); END",
    )
    .run();
  await expect(
    acceptSharedVerification(db, 'retry', 'retry-verification'),
  ).rejects.toThrow();
  expect(
    (
      await runtime.db
        .prepare(
          "SELECT * FROM invitation WHERE recipient_email='retry@example.com'",
        )
        .all()
    ).results,
  ).toEqual([]);
  expect(await member('retry@example.com')).toBeNull();
  await runtime.db.prepare('DROP TRIGGER fail_shared').run();
  expect(
    await acceptSharedVerification(db, 'retry', 'retry-verification'),
  ).toBe(true);
  expect(await sharedJoins()).toBe(1);
});

it('rejects unverified identities and direct membership writes after replacing the claimed credential', async () => {
  const link = await create();
  const db = runtime.db as unknown as D1Database;
  const now = Date.now();
  await runtime.db
    .prepare(
      "INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES('unverified','Unverified','unverified@example.com',0,?,?)",
    )
    .bind(now, now)
    .run();
  await bindSharedVerification(
    db,
    link.token,
    'unverified@example.com',
    'unverified-token',
  );
  expect(
    await acceptSharedVerification(db, 'unverified', 'unverified-token'),
  ).toBe(false);
  const claim = (await runtime.db
    .prepare(
      "SELECT invitation_id FROM invite_link_claim WHERE email='unverified@example.com'",
    )
    .first<{ invitation_id: string }>())!;
  await runtime.db
    .prepare("UPDATE user SET emailVerified=1 WHERE id='unverified'")
    .run();
  await runtime.db
    .prepare(
      "INSERT INTO invitation(id,inviter_id,recipient_email,created_at,expires_at,kind) VALUES(?,'alice','unverified@example.com',?,?,'shared')",
    )
    .bind(claim.invitation_id, now, now + 600000)
    .run();
  await replace(link.id);
  await expect(
    runtime.db
      .prepare(
        "INSERT INTO membership(user_id,invited_by,invitation_id,joined_at) VALUES('unverified','alice',?,?)",
      )
      .bind(claim.invitation_id, Date.now())
      .run(),
  ).rejects.toThrow('invite_link_unavailable');
  expect(await member('unverified@example.com')).toBeNull();
});

it.each(['verification consumption', 'identity creation'])(
  'never switches inviters if cleanup removes the claim after %s',
  async (phase) => {
    const link = await create();
    await requestEmail(link.token, 'cleanup-race@example.com');
    const message = sent.at(-1)!;
    await runtime.request('bob', '/api/invitations', 'POST', {
      email: 'cleanup-race@example.com',
    });
    // Simulate expiry cleanup during the library's validated verification flow.
    const cleanup =
      phase === 'identity creation'
        ? "CREATE TRIGGER cleanup_claim AFTER INSERT ON user WHEN NEW.email='cleanup-race@example.com' BEGIN DELETE FROM invite_link_claim WHERE email=NEW.email; END"
        : "CREATE TRIGGER cleanup_claim AFTER DELETE ON verification WHEN json_extract(OLD.value,'$.email')='cleanup-race@example.com' BEGIN DELETE FROM invite_link_claim WHERE email='cleanup-race@example.com'; END";
    await runtime.db.prepare(cleanup).run();
    expect(
      (await verify(message)).headers
        .getSetCookie()
        .some((value) => value.includes('session_token=')),
    ).toBe(false);
    expect(await member('cleanup-race@example.com')).toBeNull();
  },
);
