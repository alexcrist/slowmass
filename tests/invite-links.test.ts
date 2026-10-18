import { afterEach, beforeEach, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { unstable_splitSqlQuery } from 'wrangler';
import { testRuntime, seedProfilePhotos } from './support/runtime';
import {
  bindInviteVerification,
  acceptInviteVerification,
} from '../src/server/membership';
import { cleanupInviteLinks } from '../src/server/features/invite-links';
import { cleanupAccounts } from '../src/server/features/account';

let runtime: Awaited<ReturnType<typeof testRuntime>>;
let sent: { to: string[]; text: string }[];
let ip = 0;
const day = 86400000;
beforeEach(async () => {
  sent = [];
  runtime = await testRuntime(false, false, async (request) => {
    sent.push((await request.json()) as (typeof sent)[number]);
    return { status: 200, body: '{"id":"synthetic"}' };
  });
  for (const id of ['alice', 'bob', 'carol'])
    await runtime.request(id, '/api/people/self', 'PUT', {
      handle: id,
      displayName: id,
      bio: '',
    });
  await seedProfilePhotos(runtime.db);
  // Carol named herself but has no photo yet; David has no profile.
  await runtime.db.batch([
    runtime.db.prepare('DELETE FROM follow'),
    runtime.db.prepare("DELETE FROM avatar WHERE user_id='carol'"),
  ]);
});
afterEach(async () => {
  await runtime?.worker.dispose();
});
const db = () => runtime.db as unknown as D1Database;

async function create(actor = 'alice') {
  const response = await runtime.request(actor, '/api/invite-link', 'POST');
  expect(response.status).toBe(200);
  const link = (await response.json()) as { url: string; expiresAt: number };
  return { ...link, token: link.url.split('#invite/')[1] };
}
async function version(actor = 'alice') {
  return runtime.db
    .prepare('SELECT id FROM invite_link WHERE inviter_id=?')
    .bind(actor)
    .first<string>('id');
}
async function check(token: string) {
  const response = await runtime.request(
    null,
    '/api/invite-link/check',
    'POST',
    { token },
  );
  return ((await response.json()) as { available: boolean }).available;
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
function signedIn(response: Awaited<ReturnType<typeof verify>>) {
  return response.headers
    .getSetCookie()
    .some((value) => value.includes('session_token='));
}
// How a member joined: inviter, invitation kind, and the link version used.
async function source(email: string) {
  return runtime.db
    .prepare(
      `SELECT u.id,m.invited_by AS inviter,i.kind,i.invite_link_id AS link,i.event_id AS event
      FROM user u JOIN membership m ON m.user_id=u.id
      LEFT JOIN invitation i ON i.id=m.invitation_id WHERE u.email=?`,
    )
    .bind(email)
    .first<{
      id: string;
      inviter: string | null;
      kind: string | null;
      link: string | null;
      event: string | null;
    }>();
}
async function inviteJoins(actor = 'alice') {
  return runtime.db
    .prepare(
      "SELECT COUNT(*) AS n FROM invitation WHERE kind='shared' AND event_id IS NULL AND inviter_id=? AND accepted_by IS NOT NULL",
    )
    .bind(actor)
    .first<number>('n');
}

it('reuses one link per member, reveals only whether it works, and records the link version on joining', async () => {
  const before = Date.now();
  const link = await create();
  expect(new URL(link.url).pathname).toBe('/');
  expect(new URL(link.url).search).toBe('');
  expect(link.expiresAt).toBeGreaterThanOrEqual(before + 7 * day);
  expect(link.expiresAt).toBeLessThanOrEqual(Date.now() + 7 * day);
  // Asking again returns the same link without extending it.
  expect(await create()).toEqual(link);
  const bob = await create('bob');
  expect(bob.token).not.toBe(link.token);
  const stored = await runtime.db
    .prepare(
      "SELECT token_hash,token_encrypted FROM invite_link WHERE inviter_id='alice'",
    )
    .first();
  expect(JSON.stringify(stored)).not.toContain(link.token);

  expect(
    await (
      await runtime.request(null, '/api/invite-link/check', 'POST', {
        token: link.token,
      })
    ).json(),
  ).toEqual({ available: true });
  expect(await check('x'.repeat(48))).toBe(false);
  expect(await check('short')).toBe(false);

  // Without a working link, nobody new can request an email.
  expect((await requestEmail('x'.repeat(48), 'erin@example.com')).status).toBe(
    403,
  );
  expect(sent).toHaveLength(0);
  expect((await requestEmail(link.token, 'Erin@Example.com')).status).toBe(200);
  expect(await source('erin@example.com')).toBeNull();
  const verified = await verify();
  expect(signedIn(verified)).toBe(true);
  expect(verified.headers.get('Location')).toBe('http://localhost:8787/');
  expect(await source('erin@example.com')).toMatchObject({
    inviter: 'alice',
    kind: 'shared',
    link: await version(),
    event: null,
  });
  expect(signedIn(await verify())).toBe(false);
  expect(await inviteJoins()).toBe(1);
  // New members give only a name, then use the app without photo features.
  const cookie = verified.headers.get('Set-Cookie')!.split(';')[0];
  const asErin = (path: string, method = 'GET', body?: unknown) =>
    runtime.request(null, path, method, body, { Cookie: cookie });
  expect(await (await asErin('/api/bootstrap')).json()).toMatchObject({
    profile: null,
  });
  expect(
    (await asErin('/api/people/self', 'PUT', { displayName: 'Erin' })).status,
  ).toBe(200);
  expect((await asErin('/api/posts')).status).toBe(409);
  expect((await asErin('/api/invite-link', 'POST')).status).toBe(409);
});

it('requires a signed-in member with a profile photo and a same-origin request', async () => {
  expect((await runtime.request(null, '/api/invite-link', 'POST')).status).toBe(
    401,
  );
  expect(
    (await runtime.request('carol', '/api/invite-link', 'POST')).status,
  ).toBe(409);
  expect(
    (await runtime.request('david', '/api/invite-link', 'POST')).status,
  ).toBe(409);
  expect(
    (
      await runtime.request('alice', '/api/invite-link', 'POST', undefined, {
        Origin: 'https://elsewhere.test',
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await runtime.request('alice', '/api/invite-link/check', 'POST', {
        token: 'a'.repeat(2000),
      })
    ).status,
  ).toBe(413);
  await runtime.db
    .prepare(
      "UPDATE session SET expiresAt='2000-01-01T00:00:00.000Z' WHERE userId='alice'",
    )
    .run();
  expect(
    (await runtime.request('alice', '/api/invite-link', 'POST')).status,
  ).toBe(401);
  expect(
    (await runtime.db.prepare('SELECT * FROM invite_link').all()).results,
  ).toEqual([]);
});

it.each(['expired', 'revoked', 'unreadable'])(
  'issues a fresh link version in place after the link is %s',
  async (reason) => {
    const link = await create();
    const previous = await version();
    if (reason === 'expired')
      await runtime.db
        .prepare('UPDATE invite_link SET created_at=?,expires_at=?')
        .bind(Date.now() - 8 * day, Date.now() - 1)
        .run();
    if (reason === 'revoked')
      await runtime.db
        .prepare('UPDATE invite_link SET revoked_at=?')
        .bind(Date.now())
        .run();
    if (reason === 'unreadable')
      await runtime.db
        .prepare("UPDATE invite_link SET token_encrypted='not-ciphertext'")
        .run();
    if (reason !== 'unreadable') expect(await check(link.token)).toBe(false);
    const fresh = await create();
    expect(fresh.token).not.toBe(link.token);
    expect(await version()).not.toBe(previous);
    expect(await check(link.token)).toBe(false);
    expect(await check(fresh.token)).toBe(true);
    expect(
      (await runtime.db.prepare('SELECT * FROM invite_link').all()).results,
    ).toHaveLength(1);
  },
);

it('converges concurrent requests on one credential', async () => {
  const links = await Promise.all(
    Array.from({ length: 6 }, async () => {
      const response = await runtime.request(
        'alice',
        '/api/invite-link',
        'POST',
      );
      expect(response.status).toBe(200);
      return response.json();
    }),
  );
  expect(new Set(links.map((link) => JSON.stringify(link))).size).toBe(1);
  expect(
    (await runtime.db.prepare('SELECT * FROM invite_link').all()).results,
  ).toHaveLength(1);
});

it('creates no follows and tells the inviter once the new member adds a photo', async () => {
  const link = await create();
  await requestEmail(link.token, 'new@example.com');
  const cookie = (await verify()).headers.get('Set-Cookie')!.split(';')[0];
  const joined = (await source('new@example.com'))!;
  await runtime.request(
    null,
    '/api/people/self',
    'PUT',
    { displayName: 'New Friend' },
    { Cookie: cookie },
  );
  expect(
    (await runtime.db.prepare('SELECT * FROM follow').all()).results,
  ).toEqual([]);
  const activity = async () =>
    (
      (await (
        await runtime.request('alice', '/api/notifications?includeJoined=1')
      ).json()) as { items: { key: string; kind: string }[] }
    ).items;
  expect(await activity()).toEqual([]);
  await seedProfilePhotos(runtime.db);
  expect(await activity()).toEqual([
    expect.objectContaining({ key: `joined:${joined.id}`, kind: 'joined' }),
  ]);
  // Private posts still need an accepted follow request.
  const profile = (await (
    await runtime.request(null, '/api/bootstrap', 'GET', undefined, {
      Cookie: cookie,
    })
  ).json()) as { profile: { handle: string } };
  expect(
    (
      await runtime.request(
        'alice',
        `/api/posts?handle=${profile.profile.handle}`,
      )
    ).status,
  ).toBe(404);
});

it.each([
  'link expired',
  'link revoked',
  'claim expired',
  'inviter inactive',
  'inviter without a photo',
])(
  'rechecks the link when verifying (%s) and never falls back to another link',
  async (reason) => {
    const link = await create();
    const bob = await create('bob');
    await requestEmail(link.token, 'new@example.com');
    const message = sent.at(-1)!;
    // A second working claim for the same email must not rescue the first.
    await requestEmail(bob.token, 'new@example.com');
    if (reason === 'link expired') {
      await runtime.db
        .prepare(
          "UPDATE invite_link SET created_at=?,expires_at=? WHERE inviter_id='alice'",
        )
        .bind(Date.now() - 8 * day, Date.now() - 1)
        .run();
      // Cleanup keeps the failed claim until the email token expires.
      await cleanupInviteLinks(db());
    }
    if (reason === 'link revoked')
      await runtime.db
        .prepare("UPDATE invite_link SET revoked_at=? WHERE inviter_id='alice'")
        .bind(Date.now())
        .run();
    if (reason === 'claim expired')
      await runtime.db
        .prepare(
          "UPDATE invite_link_claim SET expires_at=? WHERE inviter_id='alice'",
        )
        .bind(Date.now() - 1)
        .run();
    if (reason === 'inviter inactive')
      await runtime.db
        .prepare(
          "UPDATE membership SET status='disabled' WHERE user_id='alice'",
        )
        .run();
    if (reason === 'inviter without a photo')
      await runtime.db
        .prepare("DELETE FROM avatar WHERE user_id='alice'")
        .run();
    const response = await verify(message);
    expect(signedIn(response)).toBe(false);
    expect(response.headers.get('Location')).toMatch(/\/\?error=invite$/);
    expect(await source('new@example.com')).toBeNull();
    // Bob's own email still works.
    expect(signedIn(await verify())).toBe(true);
    expect(await source('new@example.com')).toMatchObject({ inviter: 'bob' });
  },
);

it('signs existing members in through a link without a claim or new attribution', async () => {
  const link = await create();
  const before = await source('bob@example.com');
  expect((await requestEmail(link.token, 'bob@example.com')).status).toBe(200);
  expect(
    await runtime.db
      .prepare('SELECT COUNT(*) AS n FROM invite_link_claim')
      .first('n'),
  ).toBe(0);
  expect(signedIn(await verify())).toBe(true);
  expect(await source('bob@example.com')).toEqual(before);
  expect(await inviteJoins()).toBe(0);
});

it('admits more than 100 people through one link and keeps their provenance after renewal and deletion', async () => {
  const link = await create();
  const linkId = await version();
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
          bindInviteVerification(db(), link.token, `${id}@example.com`, id),
        ),
      )
    ).every(Boolean),
  ).toBe(true);
  expect(
    (
      await Promise.all(ids.map((id) => acceptInviteVerification(db(), id, id)))
    ).every(Boolean),
  ).toBe(true);
  // Retrying is harmless.
  expect(await acceptInviteVerification(db(), ids[0], ids[0])).toBe(true);
  expect(await inviteJoins()).toBe(101);
  // Every join through this version is countable from the link version alone.
  expect(
    await runtime.db
      .prepare('SELECT COUNT(*) AS n FROM invitation WHERE invite_link_id=?')
      .bind(linkId)
      .first('n'),
  ).toBe(101);
  const first = await source(`${ids[0]}@example.com`);
  await runtime.db
    .prepare('UPDATE invite_link SET revoked_at=?')
    .bind(Date.now())
    .run();
  await create();
  await runtime.db
    .prepare("UPDATE membership SET status='deleted' WHERE user_id=?")
    .bind(ids[1])
    .run();
  expect(await source(`${ids[0]}@example.com`)).toEqual(first);
  expect(await inviteJoins()).toBe(101);
  await expect(
    runtime.db
      .prepare(
        "UPDATE invitation SET invite_link_id='other' WHERE invite_link_id=?",
      )
      .bind(linkId)
      .run(),
  ).rejects.toThrow('immutable_invitation_link');
  expect(
    (await runtime.db.prepare('PRAGMA foreign_key_check').all()).results,
  ).toEqual([]);
});

it('keeps one inviter when two links race for the same person', async () => {
  const alice = await create();
  const bob = await create('bob');
  const now = Date.now();
  await runtime.db
    .prepare(
      "INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES('racer','Racer','racer@example.com',1,?,?)",
    )
    .bind(now, now)
    .run();
  await bindInviteVerification(db(), alice.token, 'racer@example.com', 'a');
  await bindInviteVerification(db(), bob.token, 'racer@example.com', 'b');
  await Promise.all(
    ['a', 'b'].map((token) => acceptInviteVerification(db(), 'racer', token)),
  );
  const joined = (await source('racer@example.com'))!;
  expect(['alice', 'bob']).toContain(joined.inviter);
  expect(joined.link).toBe(await version(joined.inviter!));
  expect(
    (
      await runtime.db
        .prepare(
          "SELECT * FROM invitation WHERE recipient_email='racer@example.com'",
        )
        .all()
    ).results,
  ).toHaveLength(1);
});

it('rolls back a failed membership insert and lets the same claim retry', async () => {
  const link = await create();
  const now = Date.now();
  await runtime.db
    .prepare(
      "INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES('retry','Retry','retry@example.com',1,?,?)",
    )
    .bind(now, now)
    .run();
  await bindInviteVerification(db(), link.token, 'retry@example.com', 'retry');
  await runtime.db
    .prepare(
      "CREATE TRIGGER fail_join BEFORE INSERT ON membership WHEN NEW.user_id='retry' BEGIN SELECT RAISE(ABORT,'synthetic'); END",
    )
    .run();
  await expect(
    acceptInviteVerification(db(), 'retry', 'retry'),
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
  await runtime.db.prepare('DROP TRIGGER fail_join').run();
  expect(await acceptInviteVerification(db(), 'retry', 'retry')).toBe(true);
  expect(await inviteJoins()).toBe(1);
});

it.each(['another version', 'a renewed link'])(
  'rejects unverified identities and direct membership writes recording %s',
  async (mismatch) => {
    const link = await create();
    const now = Date.now();
    await runtime.db
      .prepare(
        "INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES('direct','Direct','direct@example.com',0,?,?)",
      )
      .bind(now, now)
      .run();
    await bindInviteVerification(db(), link.token, 'direct@example.com', 'd');
    expect(await acceptInviteVerification(db(), 'direct', 'd')).toBe(false);
    const claim = (await runtime.db
      .prepare(
        'SELECT invitation_id AS invitation,invite_link_id AS link FROM invite_link_claim',
      )
      .first<{ invitation: string; link: string }>())!;
    await runtime.db
      .prepare("UPDATE user SET emailVerified=1 WHERE id='direct'")
      .run();
    await runtime.db
      .prepare(
        "INSERT INTO invitation(id,inviter_id,recipient_email,created_at,expires_at,kind,invite_link_id) VALUES(?,'alice','direct@example.com',?,?,'shared',?)",
      )
      .bind(
        claim.invitation,
        now,
        now + 600000,
        mismatch === 'another version' ? 'another-version' : claim.link,
      )
      .run();
    if (mismatch === 'a renewed link') {
      await runtime.db
        .prepare('UPDATE invite_link SET revoked_at=?')
        .bind(Date.now())
        .run();
      await create();
    }
    await expect(
      runtime.db
        .prepare(
          "INSERT INTO membership(user_id,invited_by,invitation_id,joined_at) VALUES('direct','alice',?,?)",
        )
        .bind(claim.invitation, Date.now())
        .run(),
    ).rejects.toThrow('invite_link_unavailable');
    expect(await source('direct@example.com')).toBeNull();
  },
);

it.each(['verification consumption', 'identity creation'])(
  'fails rather than falling back if cleanup removes the claim after %s',
  async (phase) => {
    const link = await create();
    await requestEmail(link.token, 'race@example.com');
    const cleanup =
      phase === 'identity creation'
        ? "CREATE TRIGGER cleanup_claim AFTER INSERT ON user WHEN NEW.email='race@example.com' BEGIN DELETE FROM invite_link_claim WHERE email=NEW.email; END"
        : "CREATE TRIGGER cleanup_claim AFTER DELETE ON verification WHEN json_extract(OLD.value,'$.email')='race@example.com' BEGIN DELETE FROM invite_link_claim WHERE email='race@example.com'; END";
    await runtime.db.prepare(cleanup).run();
    expect(signedIn(await verify())).toBe(false);
    expect(await source('race@example.com')).toBeNull();
  },
);

it('cleans up expired claims and unusable credentials but keeps link versions', async () => {
  const link = await create();
  const bob = await create('bob');
  await requestEmail(link.token, 'pending@example.com');
  await runtime.db
    .prepare('UPDATE invite_link_claim SET expires_at=?')
    .bind(Date.now() - 1)
    .run();
  await runtime.db
    .prepare(
      "UPDATE invite_link SET created_at=?,expires_at=? WHERE inviter_id='alice'",
    )
    .bind(Date.now() - 8 * day, Date.now() - 1)
    .run();
  await cleanupInviteLinks(db());
  expect(
    await runtime.db
      .prepare('SELECT COUNT(*) AS n FROM invite_link_claim')
      .first('n'),
  ).toBe(0);
  expect(
    (
      await runtime.db
        .prepare(
          'SELECT inviter_id AS inviter,token_encrypted IS NOT NULL AS readable FROM invite_link ORDER BY 1',
        )
        .all()
    ).results,
  ).toEqual([
    { inviter: 'alice', readable: 0 },
    { inviter: 'bob', readable: 1 },
  ]);
  expect(await check(bob.token)).toBe(true);
});

it('revokes the link and clears claims on account deletion while keeping provenance', async () => {
  const link = await create();
  await requestEmail(link.token, 'joined@example.com');
  await verify();
  await requestEmail(link.token, 'pending@example.com');
  const joined = await source('joined@example.com');
  expect(
    (
      await runtime.request('alice', '/api/me', 'DELETE', {
        confirmation: 'DELETE',
      })
    ).status,
  ).toBe(200);
  expect(await check(link.token)).toBe(false);
  await cleanupAccounts(db());
  expect(
    await runtime.db
      .prepare(
        "SELECT token_encrypted,revoked_at FROM invite_link WHERE inviter_id='alice'",
      )
      .first(),
  ).toEqual({ token_encrypted: null, revoked_at: expect.any(Number) });
  expect(await source('joined@example.com')).toEqual(joined);
  expect(signedIn(await verify())).toBe(false);
});

it('migration 0032 keeps existing invitations and event joins working', async () => {
  const old = await testRuntime(false, false, undefined, undefined, 31);
  try {
    await old.db
      .prepare(
        "INSERT INTO invitation(id,inviter_id,recipient_email,created_at,expires_at,kind) VALUES('legacy','alice','legacy@example.com',1,2,'shared')",
      )
      .run();
    const before = (
      await old.db.prepare('SELECT * FROM invitation ORDER BY id').all()
    ).results;
    await old.db.batch(
      unstable_splitSqlQuery(
        readFileSync('migrations/0032_invite_links.sql', 'utf8'),
      ).map((query) => old.db.prepare(query)),
    );
    expect(
      (await old.db.prepare('SELECT * FROM invitation ORDER BY id').all())
        .results,
    ).toEqual(before.map((row) => ({ ...row, invite_link_id: null })));
    expect(
      (await old.db.prepare('PRAGMA foreign_key_check').all()).results,
    ).toEqual([]);
  } finally {
    await old.worker.dispose();
  }
});
