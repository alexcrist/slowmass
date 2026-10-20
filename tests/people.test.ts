import { beforeAll, beforeEach, afterAll, expect, it } from 'vitest';
import { reservePhoto } from '../src/server/photos/storage';
import { cleanupAvatars } from '../src/server/features/avatars/cleanup';
import { testRuntime, seedProfilePhotos } from './support/runtime';
let runtime: Awaited<ReturnType<typeof testRuntime>>;
beforeAll(async () => {
  runtime = await testRuntime();
});
afterAll(async () => {
  await runtime?.worker.dispose();
});
beforeEach(async () => {
  await runtime.db.batch(
    [
      'DELETE FROM avatar',
      'DELETE FROM comment_like',
      'DELETE FROM comment',
      'DELETE FROM post_like',
      'DELETE FROM post',
      'DELETE FROM photo_cleanup',
      'DELETE FROM photo_attempt',
      'DELETE FROM follow',
      'DELETE FROM block',
      'DELETE FROM profile',
      `DELETE FROM "rateLimit" WHERE key LIKE 'discovery:%'`,
    ].map((sql) => runtime.db.prepare(sql)),
  );
  for (const id of ['alice', 'bob', 'carol']) {
    expect(
      (
        await runtime.request(id, '/api/people/self', 'PUT', {
          handle: id,
          displayName: id,
          bio: `Private bio for ${id}`,
        })
      ).status,
    ).toBe(200);
  }
  await seedProfilePhotos(runtime.db);
  await runtime.db.prepare('DELETE FROM follow').run(); // Independent users for permission tests.
});
const action = (actor: string, target: string, command: string) =>
  runtime.request(actor, `/api/people/${target}/${command}`, 'POST');
const read = async (actor: string, target: string) =>
  (await runtime.request(actor, `/api/people/${target}`)).json() as Promise<{
    profile: { bio: string | null; relationship: string };
  }>;
it('lets unfinished members browse identities while keeping relationships and posts gated', async () => {
  await runtime.request('david', '/api/people/self', 'PUT', {
    displayName: 'David',
  });
  // Legacy personal invitations create follows before photo completion.
  expect(
    await runtime.db
      .prepare(
        "SELECT status FROM follow WHERE follower_id='david' AND target_id='alice'",
      )
      .first('status'),
  ).toBe('accepted');
  const response = await runtime.request('david', '/api/people/alice');
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(await response.json()).toEqual({
    profile: {
      handle: 'alice',
      displayName: 'alice',
      bio: null,
      relationship: 'none',
    },
  });
  expect((await read('david', 'bob')).profile).toMatchObject({
    bio: null,
    relationship: 'none',
  });
  const bucket = await runtime.worker.getR2Bucket('PHOTOS');
  await bucket.put('test-avatar/bob', 'synthetic avatar bytes');
  const avatar = await runtime.request('david', '/media/avatar/bob');
  expect(avatar.status).toBe(200);
  expect(avatar.headers.get('cache-control')).toBe('private, no-store');
  await avatar.arrayBuffer();
  for (const path of [
    '/api/people/connections?kind=following',
    '/api/people/connections?kind=requests',
    '/api/people/alice/connections?kind=followers',
    '/api/posts',
    '/api/posts?handle=alice',
  ])
    expect((await runtime.request('david', path)).status).toBe(409);
  for (const command of [
    'request',
    'request',
    'cancel',
    'accept',
    'deny',
    'unfollow',
    'remove',
    'block',
    'unblock',
  ])
    expect((await action('david', 'bob', command)).status).toBe(409);
  expect(
    (await runtime.request('david', '/api/posts', 'POST', {})).status,
  ).toBe(409);
  expect(
    await runtime.db
      .prepare(
        "SELECT 1 FROM follow WHERE follower_id='david' AND target_id='bob'",
      )
      .first(),
  ).toBeNull();
  await seedProfilePhotos(runtime.db);
  expect((await action('david', 'bob', 'request')).status).toBe(200);
});

it('keeps event-only discovery and profile reads private, filtered, and rate limited', async () => {
  await runtime.request('david', '/api/people/self', 'PUT', {
    displayName: 'David',
  });
  const directory = '/api/people/discover?seed=' + '0'.repeat(32);
  const browse = async (query = '') =>
    (await (await runtime.request('david', directory + query)).json()) as {
      items: { handle: string }[];
      next: string | null;
    };
  expect((await browse()).items.map((person) => person.handle).sort()).toEqual([
    'alice',
    'bob',
    'carol',
  ]);
  expect((await browse('&q=alc')).items).toEqual([
    { handle: 'alice', displayName: 'alice' },
  ]);
  await action('bob', 'david', 'block');
  expect((await runtime.request('david', '/api/people/bob')).status).toBe(404);
  expect((await runtime.request('david', '/media/avatar/bob')).status).toBe(
    404,
  );
  expect((await browse()).items.some((person) => person.handle === 'bob')).toBe(
    false,
  );
  // Blocks in either direction continue to apply to unfinished viewers.
  await action('bob', 'david', 'unblock');
  await runtime.db
    .prepare(
      "INSERT INTO block(blocker_id,target_id,created_at) VALUES('david','bob',0)",
    )
    .run();
  expect((await runtime.request('david', '/api/people/bob')).status).toBe(404);
  for (const status of ['disabled', 'deleted']) {
    await runtime.db
      .prepare('UPDATE membership SET status=? WHERE user_id=?')
      .bind(status, 'carol')
      .run();
    try {
      expect((await runtime.request('david', '/api/people/carol')).status).toBe(
        404,
      );
      expect((await browse()).items.map((person) => person.handle)).toEqual([
        'alice',
      ]);
    } finally {
      await runtime.db
        .prepare("UPDATE membership SET status='active' WHERE user_id='carol'")
        .run();
    }
  }
  // Consume the remaining allowance in the current discovery window.
  await runtime.db
    .prepare(
      'UPDATE "rateLimit" SET count=30, lastRequest=? WHERE key=\'discovery:david\'',
    )
    .bind(Date.now())
    .run();
  expect((await runtime.request('david', directory)).status).toBe(429);
  await runtime.db
    .prepare(
      "INSERT INTO session(id,userId,token,expiresAt,createdAt,updatedAt) VALUES('event-expired','david','event-expired-token','2020-01-01T00:00:00.000Z',0,0)",
    )
    .run();
  for (const viewer of [null, 'event-expired']) {
    expect((await runtime.request(viewer, '/api/people/alice')).status).toBe(
      401,
    );
    expect((await runtime.request(viewer, directory)).status).toBe(401);
    expect((await runtime.request(viewer, '/media/avatar/alice')).status).toBe(
      404,
    );
  }
});

it('requires a session and preserves private bios until the owner accepts', async () => {
  expect((await runtime.request(null, '/api/people/bob')).status).toBe(401);
  expect((await read('alice', 'bob')).profile.bio).toBeNull();
  expect((await action('alice', 'bob', 'request')).status).toBe(200);
  expect((await action('alice', 'bob', 'request')).status).toBe(200);
  expect((await read('alice', 'bob')).profile).toMatchObject({
    bio: null,
    relationship: 'pending',
  });
  await action('carol', 'alice', 'accept'); // A third party cannot accept Bob's request.
  expect((await read('alice', 'bob')).profile.bio).toBeNull();
  const pending = await (
    await runtime.request('bob', '/api/people/connections?kind=requests')
  ).json();
  expect(pending).toEqual({
    items: [{ handle: 'alice', displayName: 'alice' }],
    next: null,
  });
  await action('bob', 'alice', 'accept');
  expect((await read('alice', 'bob')).profile).toMatchObject({
    bio: 'Private bio for bob',
    relationship: 'accepted',
  });
  expect((await read('carol', 'bob')).profile.bio).toBeNull();
  expect((await read('bob', 'alice')).profile.bio).toBeNull(); // follows are directional
  await action('bob', 'alice', 'remove');
  expect((await read('alice', 'bob')).profile).toMatchObject({
    bio: null,
    relationship: 'none',
  });
});
it('handles crossing requests, blocking in both directions, and unblock without restoration', async () => {
  await Promise.all([
    action('alice', 'bob', 'request'),
    action('bob', 'alice', 'request'),
  ]);
  await Promise.all([
    action('alice', 'bob', 'accept'),
    action('bob', 'alice', 'accept'),
  ]);
  expect((await read('alice', 'bob')).profile.relationship).toBe('accepted');
  expect((await read('bob', 'alice')).profile.relationship).toBe('accepted');
  await Promise.all([
    action('alice', 'bob', 'block'),
    action('bob', 'alice', 'request'),
  ]);
  expect((await runtime.request('bob', '/api/people/alice')).status).toBe(404);
  expect((await runtime.request('alice', '/api/people/bob')).status).toBe(404);
  expect((await action('bob', 'alice', 'request')).status).toBe(404);
  expect(await runtime.db.prepare('SELECT 1 FROM follow').first()).toBeNull();
  expect(
    await (
      await runtime.request('alice', '/api/people/connections?kind=blocked')
    ).json(),
  ).toEqual({ items: [{ handle: 'bob', displayName: 'bob' }], next: null });
  await action('alice', 'bob', 'unblock');
  expect((await read('alice', 'bob')).profile.relationship).toBe('none');
  expect((await read('bob', 'alice')).profile.relationship).toBe('none');
});
it('supports cancel, deny, and unfollow without changing another relationship', async () => {
  await action('alice', 'bob', 'request');
  await action('alice', 'bob', 'cancel');
  expect((await read('alice', 'bob')).profile.relationship).toBe('none');
  await action('alice', 'bob', 'request');
  await action('bob', 'alice', 'deny');
  expect((await read('alice', 'bob')).profile.relationship).toBe('none');
  await action('alice', 'bob', 'request');
  await action('bob', 'alice', 'accept');
  await action('bob', 'alice', 'deny'); // Stale deny must not remove an accepted follower.
  expect((await read('alice', 'bob')).profile.relationship).toBe('accepted');
  await action('alice', 'bob', 'unfollow');
  expect((await read('alice', 'bob')).profile.bio).toBeNull();
  expect((await action('alice', 'alice', 'request')).status).toBe(409);
});
it('validates unique handles and allows changing a username with profile edits', async () => {
  expect(
    (
      await runtime.request('david', '/api/people/self', 'PUT', {
        handle: 'a',
        displayName: 'D',
        bio: '',
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await runtime.request('david', '/api/people/self', 'PUT', {
        handle: 'ALICE',
        displayName: 'D',
        bio: '',
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await runtime.request('david', '/api/people/self', 'PUT', {
        handle: 'david',
        displayName: 'D',
        bio: 'hello',
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await runtime.request('david', '/api/people/self', 'PUT', {
        handle: 'new_handle',
        displayName: 'D',
        bio: '',
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await runtime.request('david', '/api/people/self', 'PUT', {
        handle: 'david',
        displayName: 'Updated',
        bio: 'changed',
        hasAvatar: 0,
      })
    ).status,
  ).toBe(200);
  expect(
    await (await runtime.request('david', '/api/people/self')).json(),
  ).toEqual({
    profile: {
      handle: 'david',
      displayName: 'Updated',
      bio: 'changed',
      hasAvatar: 0,
    },
  });
});
it('releases renamed handles while preserving identity, content, relationships, and invitation provenance', async () => {
  await action('alice', 'bob', 'request');
  await action('bob', 'alice', 'accept');
  await runtime.db.batch([
    runtime.db.prepare(
      "INSERT INTO post(id,user_id,caption,alt_text,created_at,published_at,state,object_key,width,height) VALUES('rename_post','bob','Photo','',1,1,'published','post/rename',100,100)",
    ),
    runtime.db.prepare(
      "INSERT INTO post_like(post_id,user_id,created_at) VALUES('rename_post','alice',2)",
    ),
    runtime.db.prepare(
      "INSERT INTO comment(id,post_id,user_id,body,created_at) VALUES('rename_comment','rename_post','bob','Hello',3)",
    ),
  ]);
  const before = await runtime.db
    .prepare("SELECT * FROM membership WHERE user_id='bob'")
    .first();
  const result = await runtime.request('bob', '/api/people/self', 'PUT', {
    handle: 'BOBBY',
    displayName: 'Bob',
    bio: 'Private',
  });
  expect(result.status).toBe(200);
  expect(await result.json()).toMatchObject({
    profile: { handle: 'bobby', hasAvatar: 1 },
  });
  expect((await runtime.request('alice', '/api/people/bob')).status).toBe(404);
  expect(await read('alice', 'bobby')).toMatchObject({
    profile: { relationship: 'accepted', bio: 'Private' },
  });
  expect((await read('carol', 'bobby')).profile.bio).toBeNull();
  const posts = await (
    await runtime.request('alice', '/api/posts?handle=bobby')
  ).json();
  expect(posts).toMatchObject({
    items: [
      { id: 'rename_post', handle: 'bobby', likeCount: 1, commentCount: 1 },
    ],
  });
  expect(
    await runtime.db
      .prepare("SELECT * FROM membership WHERE user_id='bob'")
      .first(),
  ).toEqual(before);
  expect(
    (
      await runtime.request('carol', '/api/people/self', 'PUT', {
        handle: 'bob',
        displayName: 'Carol',
        bio: '',
      })
    ).status,
  ).toBe(200);
  expect(
    await (await runtime.request('alice', '/api/people/bob')).json(),
  ).toMatchObject({ profile: { displayName: 'Carol', relationship: 'none' } });
  await action('bob', 'alice', 'block');
  expect((await runtime.request('alice', '/api/people/bobby')).status).toBe(
    404,
  );
});

it('arbitrates simultaneous rename claims and retries without changing another account', async () => {
  for (const handle of ['self', 'discover', 'connections']) {
    expect(
      (
        await runtime.request('alice', '/api/people/self', 'PUT', {
          handle,
          displayName: 'Alice',
          bio: '',
        })
      ).status,
    ).toBe(409);
  }
  const change = (id: string) =>
    runtime.request(id, '/api/people/self', 'PUT', {
      handle: 'shared_handle',
      displayName: id,
      bio: '',
    });
  const results = await Promise.all([change('alice'), change('bob')]);
  expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
  const winner = results[0].status === 200 ? 'alice' : 'bob';
  const loser = winner === 'alice' ? 'bob' : 'alice';
  expect((await change(winner)).status).toBe(200);
  expect(
    await (await runtime.request(loser, '/api/people/self')).json(),
  ).toMatchObject({ profile: { handle: loser, displayName: loser } });
  expect(
    (
      await runtime.request(null, '/api/people/self', 'PUT', {
        handle: 'stolen',
        displayName: 'No',
        bio: '',
      })
    ).status,
  ).toBe(401);
});

it('does not grant access when an account is disabled', async () => {
  await action('alice', 'bob', 'request');
  await action('bob', 'alice', 'accept');
  await runtime.db
    .prepare("UPDATE membership SET status='disabled' WHERE user_id='bob'")
    .run();
  expect((await runtime.request('alice', '/api/people/bob')).status).toBe(404);
  expect((await runtime.request('bob', '/api/people/self')).status).toBe(401);
  await runtime.db
    .prepare("UPDATE membership SET status='active' WHERE user_id='bob'")
    .run();
});
it('validates pagination and scopes lists to the signed-in account', async () => {
  await action('alice', 'bob', 'request');
  expect(
    await (
      await runtime.request('carol', '/api/people/connections?kind=requests')
    ).json(),
  ).toEqual({ items: [], next: null });
  expect(
    (await runtime.request('bob', '/api/people/connections?kind=all')).status,
  ).toBe(400);
  expect(
    (await runtime.request('bob', '/api/people/connections?after=%27')).status,
  ).toBe(400);
});
it('shares avatars with members while enforcing blocks and preventing removal', async () => {
  const bucket = await runtime.worker.getR2Bucket('PHOTOS');
  await bucket.put('avatar-test', 'synthetic image bytes');
  await runtime.db
    .prepare(
      'INSERT OR REPLACE INTO avatar (user_id,object_key,width,height) VALUES (?,?,1,1)',
    )
    .bind('bob', 'avatar-test')
    .run();
  const path = '/media/avatar/bob';
  expect((await runtime.request(null, path)).status).toBe(404);
  expect((await runtime.request('carol', path)).status).toBe(200);
  expect((await runtime.request('bob', path)).status).toBe(200);
  await action('alice', 'bob', 'request');
  expect((await runtime.request('alice', path)).status).toBe(200);
  await action('bob', 'alice', 'accept');
  const visible = await runtime.request('alice', path);
  expect(visible.status).toBe(200);
  expect(visible.headers.get('cache-control')).toBe('private, no-store');
  await action('bob', 'alice', 'remove');
  expect((await runtime.request('alice', path)).status).toBe(200);
  await action('bob', 'alice', 'block');
  expect((await runtime.request('alice', path)).status).toBe(404);
  expect((await runtime.request('bob', '/api/avatar', 'DELETE')).status).toBe(
    409,
  );
  expect((await runtime.request('bob', path)).status).toBe(200);
  expect(
    await runtime.db
      .prepare("SELECT object_key FROM avatar WHERE user_id='bob'")
      .first(),
  ).toEqual({ object_key: 'avatar-test' });
});

it.each(['following', 'followers'] as const)(
  'shares profile %s only with the owner and current accepted followers',
  async (kind) => {
    const path = `/api/people/bob/connections?kind=${kind}`;
    expect((await runtime.request(null, path)).status).toBe(401);
    expect(await (await runtime.request('bob', path)).json()).toEqual({
      items: [],
      next: null,
    });
    expect((await runtime.request('alice', path)).status).toBe(404);
    await action('bob', 'alice', 'request');
    await action('alice', 'bob', 'accept');
    expect((await runtime.request('alice', path)).status).toBe(404); // Reverse follows grant no access.
    await action('alice', 'bob', 'request');
    expect((await runtime.request('alice', path)).status).toBe(404);
    await action('bob', 'alice', 'accept');
    const allowed = await runtime.request('alice', path);
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get('cache-control')).toBe('private, no-store');
    expect(await allowed.json()).toEqual({
      items: [{ handle: 'alice', displayName: 'alice' }],
      next: null,
    });
    await action('bob', 'alice', 'remove');
    expect((await runtime.request('alice', path)).status).toBe(404);
    await action('alice', 'bob', 'request');
    await action('bob', 'alice', 'accept');
    await action('alice', 'bob', 'unfollow');
    expect((await runtime.request('alice', path)).status).toBe(404);
    await action('alice', 'bob', 'request');
    await action('bob', 'alice', 'accept');
    for (const [actor, target] of [
      ['alice', 'bob'],
      ['bob', 'alice'],
    ]) {
      await action(actor, target, 'block');
      expect((await runtime.request('alice', path)).status).toBe(404);
      await action(actor, target, 'unblock');
      expect((await runtime.request('alice', path)).status).toBe(404);
    }
  },
);

it.each(['following', 'followers'] as const)(
  'filters pending, blocked, inactive, deleted, and unfinished members from profile %s',
  async (kind) => {
    const path = `/api/people/bob/connections?kind=${kind}`;
    await action('alice', 'bob', 'request');
    await action('bob', 'alice', 'accept');
    const actor = kind === 'following' ? 'bob' : 'carol';
    const target = kind === 'following' ? 'carol' : 'bob';
    await action(actor, target, 'request');
    const handles = async () => {
      const page = (await (await runtime.request('alice', path)).json()) as {
        items: { handle: string }[];
      };
      return page.items.map((person) => person.handle);
    };
    expect(await handles()).not.toContain('carol');
    await action(target, actor, 'accept');
    expect(await handles()).toContain('carol');
    for (const [blocker, blocked] of [
      ['alice', 'carol'],
      ['carol', 'alice'],
    ]) {
      await action(blocker, blocked, 'block');
      expect(await handles()).not.toContain('carol');
      await action(blocker, blocked, 'unblock');
      expect(await handles()).toContain('carol');
    }
    for (const status of ['disabled', 'deleted']) {
      try {
        await runtime.db
          .prepare('UPDATE membership SET status=? WHERE user_id=?')
          .bind(status, 'carol')
          .run();
        expect(await handles()).not.toContain('carol');
        await runtime.db
          .prepare('UPDATE membership SET status=? WHERE user_id=?')
          .bind(status, 'bob')
          .run();
        expect((await runtime.request('alice', path)).status).toBe(404);
      } finally {
        await runtime.db
          .prepare(
            "UPDATE membership SET status='active' WHERE user_id IN ('bob','carol')",
          )
          .run();
      }
    }
    await runtime.db.prepare("DELETE FROM avatar WHERE user_id='carol'").run();
    expect(await handles()).not.toContain('carol');
    await runtime.db.prepare("DELETE FROM avatar WHERE user_id='bob'").run();
    expect((await runtime.request('alice', path)).status).toBe(404);
  },
);

it('keeps requests and blocks owner-only and rejects invalid pages and expired sessions', async () => {
  await action('alice', 'bob', 'request');
  await action('bob', 'alice', 'accept');
  for (const query of [
    'kind=requests',
    'kind=blocked',
    'kind=all',
    '',
    'kind=followers&after=%27',
  ]) {
    expect(
      (await runtime.request('alice', `/api/people/bob/connections?${query}`))
        .status,
    ).toBe(400);
  }
  expect(
    (
      await runtime.request(
        'alice',
        '/api/people/missing/connections?kind=following',
      )
    ).status,
  ).toBe(404);
  await runtime.db
    .prepare(
      "INSERT INTO session(id,userId,token,expiresAt,createdAt,updatedAt) VALUES('expired','alice','expired-token','2020-01-01T00:00:00.000Z',0,0)",
    )
    .run();
  expect(
    (
      await runtime.request(
        'expired',
        '/api/people/bob/connections?kind=following',
      )
    ).status,
  ).toBe(401);
});

it('paginates other members’ connections after visibility filtering and rechecks access on later pages', async () => {
  const expected = [];
  for (let i = 0; i < 22; i++) {
    const id = `connection${i.toString().padStart(2, '0')}`;
    const now = Date.now();
    await runtime.db.batch([
      runtime.db
        .prepare(
          'INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,1,?,?)',
        )
        .bind(id, id, `${id}@example.com`, now, now),
      runtime.db
        .prepare(
          "INSERT INTO invitation(id,inviter_id,recipient_email,created_at,expires_at) VALUES(?,'alice',?,?,?)",
        )
        .bind(id, `${id}@example.com`, now, now + 60000),
      runtime.db
        .prepare(
          "INSERT INTO membership(user_id,invited_by,invitation_id,joined_at) VALUES(?,'alice',?,?)",
        )
        .bind(id, id, now),
      runtime.db
        .prepare(
          'INSERT INTO profile(user_id,handle,display_name,created_at) VALUES(?,?,?,?)',
        )
        .bind(id, id, id, now),
    ]);
    if (i > 0) expected.push(id);
  }
  await seedProfilePhotos(runtime.db);
  await action('bob', 'alice', 'request');
  await action('alice', 'bob', 'accept');
  await action('bob', 'connection00', 'block');
  for (const kind of ['following', 'followers']) {
    const path = `/api/people/alice/connections?kind=${kind}`;
    const first = (await (await runtime.request('bob', path)).json()) as {
      items: { handle: string }[];
      next: string;
    };
    expect(first.items).toHaveLength(20);
    expect(first.next).toBe(first.items.at(-1)?.handle);
    const second = (await (
      await runtime.request('bob', `${path}&after=${first.next}`)
    ).json()) as { items: { handle: string }[]; next: null };
    expect(second.next).toBeNull();
    expect(
      [...first.items, ...second.items].map((person) => person.handle),
    ).toEqual(kind === 'followers' ? ['bob', ...expected] : expected);
  }
  await action('alice', 'bob', 'remove');
  expect(
    (
      await runtime.request(
        'bob',
        '/api/people/alice/connections?kind=following&after=connection20',
      )
    ).status,
  ).toBe(404);
});

it('bounds processing attempts, deduplicates retries and cleans orphaned objects', async () => {
  const db = runtime.db as unknown as D1Database;
  const bucket = await runtime.worker.getR2Bucket('PHOTOS');
  for (let i = 0; i < 5; i++)
    expect(await reservePhoto(db, 'alice', String(i))).toBe('reserved');
  expect(await reservePhoto(db, 'alice', '0')).toBe('pending');
  expect(await reservePhoto(db, 'alice', '6')).toBe('quota');
  expect(await reservePhoto(db, 'bob', '0')).toBe('reserved');
  await runtime.db
    .prepare("UPDATE photo_attempt SET state='done' WHERE id='alice:0'")
    .run();
  expect(await reservePhoto(db, 'alice', '0')).toBe('done');
  await bucket.put('avatars/orphan', 'orphan bytes');
  await bucket.put('avatars/current', 'current bytes');
  await runtime.db
    .prepare(
      'INSERT OR REPLACE INTO avatar(user_id,object_key,width,height) VALUES(?,?,1,1)',
    )
    .bind('bob', 'avatars/current')
    .run();
  for (const key of ['avatars/orphan', 'avatars/current'])
    await runtime.db
      .prepare('INSERT INTO photo_cleanup(object_key,not_before) VALUES(?,0)')
      .bind(key)
      .run();
  await cleanupAvatars(db, bucket as unknown as R2Bucket);
  expect(await bucket.get('avatars/orphan')).toBeNull();
  expect(await bucket.get('avatars/current')).not.toBeNull();
  expect(
    await runtime.db
      .prepare("SELECT 1 FROM photo_cleanup WHERE object_key='avatars/orphan'")
      .first(),
  ).toBeNull();
});

it('allows a reciprocal block while lookup is hidden', async () => {
  await action('alice', 'bob', 'block');
  await action('bob', 'alice', 'block');
  await action('alice', 'bob', 'unblock');
  expect((await runtime.request('alice', '/api/people/bob')).status).toBe(404);
  await action('bob', 'alice', 'unblock');
  expect((await runtime.request('alice', '/api/people/bob')).status).toBe(200);
});

it('automatically follows the inviter in both directions only at profile creation', async () => {
  await runtime.request('david', '/api/people/self', 'PUT', {
    handle: 'david',
    displayName: 'David',
    bio: '',
  });
  await seedProfilePhotos(runtime.db);
  expect((await read('alice', 'david')).profile.relationship).toBe('accepted');
  expect((await read('david', 'alice')).profile.relationship).toBe('accepted');
  await action('david', 'alice', 'unfollow');
  await runtime.request('david', '/api/people/self', 'PUT', {
    handle: 'david',
    displayName: 'David updated',
    bio: '',
  });
  expect((await read('david', 'alice')).profile.relationship).toBe('none');
  expect((await read('alice', 'david')).profile.relationship).toBe('accepted');
});
it('discovers active unblocked members with partial name matching and bounded pages', async () => {
  const seed = '8'.repeat(32);
  const url = `/api/people/discover?seed=${seed}`;
  expect((await runtime.request(null, url)).status).toBe(401);
  expect((await runtime.request('alice', url + '&q=bo')).status).toBe(400);
  const match = (await (
    await runtime.request('alice', url + '&q=BOB')
  ).json()) as { items: { handle: string }[] };
  expect(match.items.map((x) => x.handle)).toEqual(['bob']);
  const fuzzy = await (await runtime.request('bob', url + '&q=alc')).json();
  expect(fuzzy).toMatchObject({ items: [{ handle: 'alice' }] });
  expect(
    await (await runtime.request('alice', url + '&q=b%25b')).json(),
  ).toMatchObject({ items: [] });
  await action('bob', 'alice', 'block');
  const blocked = (await (await runtime.request('alice', url)).json()) as {
    items: { handle: string }[];
  };
  expect(blocked.items.map((x) => x.handle)).toEqual(['carol']);
  await runtime.db
    .prepare("UPDATE membership SET status='disabled' WHERE user_id='carol'")
    .run();
  expect(await (await runtime.request('alice', url)).json()).toMatchObject({
    items: [],
  });
  await runtime.db
    .prepare("UPDATE membership SET status='active' WHERE user_id='carol'")
    .run();
});
it('preserves shuffled discovery order across pages without duplicate people and limits searches', async () => {
  for (let i = 0; i < 24; i++) {
    const id = `person${i.toString().padStart(2, '0')}`,
      now = Date.now();
    await runtime.db
      .prepare(
        'INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,1,?,?)',
      )
      .bind(id, id, `${id}@example.com`, now, now)
      .run();
    await runtime.db
      .prepare(
        "INSERT INTO invitation(id,inviter_id,recipient_email,created_at,expires_at) VALUES(?,'alice',?,?,?)",
      )
      .bind(id, `${id}@example.com`, now, now + 60000)
      .run();
    await runtime.db
      .prepare(
        "INSERT INTO membership(user_id,invited_by,invitation_id,joined_at) VALUES(?,'alice',?,?)",
      )
      .bind(id, id, now)
      .run();
    await runtime.db
      .prepare(
        'INSERT INTO profile(user_id,handle,display_name,created_at) VALUES(?,?,?,?)',
      )
      .bind(id, id, id, now)
      .run();
  }
  await seedProfilePhotos(runtime.db);
  const url = '/api/people/discover?seed=' + '7'.repeat(32);
  const first = (await (await runtime.request('alice', url)).json()) as {
    items: { handle: string }[];
    next: string;
  };
  expect(first.items).toHaveLength(20);
  expect(first.next).toBeTruthy();
  const second = (await (
    await runtime.request('alice', url + '&after=' + first.next)
  ).json()) as { items: { handle: string }[]; next: null };
  const handles = [...first.items, ...second.items].map((x) => x.handle);
  expect(handles.length).toBe(26);
  expect(new Set(handles).size).toBe(26);
  expect(second.next).toBeNull();
  expect(await (await runtime.request('alice', url)).json()).toEqual(first);
  for (let i = 0; i < 30; i++)
    expect((await runtime.request('bob', url)).status).toBe(200);
  expect((await runtime.request('bob', url)).status).toBe(429);
});
it('keeps unfinished onboarding profiles out of member profiles, discovery and connections', async () => {
  await runtime.request('david', '/api/people/self', 'PUT', {
    handle: 'david',
    displayName: 'David',
    bio: '',
  });
  const directory = '/api/people/discover?seed=' + '0'.repeat(32);
  expect((await runtime.request('alice', '/api/people/david')).status).toBe(
    404,
  );
  for (const path of [
    directory,
    '/api/people/connections?kind=following',
    '/api/people/connections?kind=followers',
  ]) {
    const page = (await (await runtime.request('alice', path)).json()) as {
      items: { handle: string }[];
    };
    expect(page.items.some((person) => person.handle === 'david')).toBe(false);
  }
  await seedProfilePhotos(runtime.db);
  expect((await runtime.request('alice', '/api/people/david')).status).toBe(
    200,
  );
  for (const path of [
    directory,
    '/api/people/connections?kind=following',
    '/api/people/connections?kind=followers',
  ]) {
    const page = (await (await runtime.request('alice', path)).json()) as {
      items: { handle: string }[];
    };
    expect(page.items.some((person) => person.handle === 'david')).toBe(true);
    expect(page.items.every((person) => !('hasAvatar' in person))).toBe(true);
  }
});
