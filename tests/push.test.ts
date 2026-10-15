import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { createECDH, createPublicKey, randomBytes, verify } from 'node:crypto';
import { createRequire } from 'node:module';
import { seedProfilePhotos, testRuntime } from './support/runtime';

const decrypt: (
  body: Buffer,
  options: {
    version: string;
    privateKey: ReturnType<typeof createECDH>;
    authSecret: Buffer;
  },
) => Buffer = createRequire(import.meta.url)('http_ece').decrypt;
const vapid = createECDH('prime256v1');
vapid.generateKeys();
const browser = createECDH('prime256v1');
browser.generateKeys();
const auth = randomBytes(16);
const subscription = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/synthetic',
  keys: {
    p256dh: browser.getPublicKey().toString('base64url'),
    auth: auth.toString('base64url'),
  },
};
let runtime: Awaited<ReturnType<typeof testRuntime>>;
let sent: { headers: Headers; body: Buffer }[];
let responseStatus = 201;
let responseHeaders: Record<string, string> = {};
let pauseSend: (() => Promise<void>) | undefined;
beforeAll(async () => {
  runtime = await testRuntime(false, false, undefined, {
    publicKey: vapid.getPublicKey().toString('base64url'),
    privateKey: vapid.getPrivateKey().toString('base64url'),
    send: async (request) => {
      sent.push({
        headers: request.headers,
        body: Buffer.from(await request.arrayBuffer()),
      });
      await pauseSend?.();
      return { status: responseStatus, headers: responseHeaders };
    },
  });
  for (const id of ['alice', 'bob', 'carol', 'david'])
    await runtime.request(id, '/api/people/self', 'PUT', {
      handle: id,
      displayName: id,
      bio: '',
    });
  await seedProfilePhotos(runtime.db);
});
afterAll(async () => {
  await runtime?.worker.dispose();
});
beforeEach(async () => {
  sent = [];
  responseStatus = 201;
  responseHeaders = {};
  pauseSend = undefined;
  await runtime.db.batch([
    runtime.db.prepare('DELETE FROM push_subscription'),
    runtime.db.prepare('DELETE FROM follow'),
    runtime.db.prepare('DELETE FROM block'),
    runtime.db.prepare('DELETE FROM comment'),
    runtime.db.prepare('DELETE FROM post_like'),
    runtime.db.prepare('DELETE FROM post'),
    runtime.db.prepare("UPDATE membership SET status='active'"),
    runtime.db
      .prepare('UPDATE session SET expiresAt=?')
      .bind(Date.now() + 86400000),
  ]);
});
async function enable(actor = 'alice', endpoint = subscription.endpoint) {
  const result = await runtime.request(actor, '/api/push/device', 'PUT', {
    ...subscription,
    endpoint,
  });
  expect(result.status).toBe(200);
}
async function tick() {
  const result = await (
    await runtime.worker.getWorker()
  ).scheduled({ cron: '0 * * * *' });
  expect(result.outcome).toBe('ok');
}
async function photo() {
  await runtime.db
    .prepare(
      "INSERT INTO post(id,user_id,caption,alt_text,created_at,published_at,state,object_key,width,height) VALUES('photo','alice','','',1,1,'published','posts/photo',1,1)",
    )
    .run();
}
async function pendingRequest() {
  await runtime.db
    .prepare("INSERT INTO follow VALUES('bob','alice','pending',1000)")
    .run();
}
async function count(table: 'push_delivery' | 'push_subscription') {
  return runtime.db
    .prepare(`SELECT COUNT(*) AS n FROM ${table}`)
    .first<number>('n');
}
it('keeps hourly delivery separate from maintenance and ignores obsolete schedules', async () => {
  await enable();
  await pendingRequest();
  await runtime.db
    .prepare(
      'INSERT INTO session(id,userId,token,expiresAt,createdAt,updatedAt) VALUES(?,?,?,?,?,?)',
    )
    .bind('maintenance-probe', 'carol', 'maintenance-probe-token', 0, 0, 0)
    .run();
  const worker = await runtime.worker.getWorker();
  expect((await worker.scheduled({ cron: '* * * * *' })).outcome).toBe('ok');
  expect(
    await runtime.db
      .prepare("SELECT 1 FROM session WHERE id='maintenance-probe'")
      .first(),
  ).not.toBeNull();
  expect(sent).toHaveLength(0);
  expect(await count('push_delivery')).toBe(1);
  expect((await worker.scheduled({ cron: '*/15 * * * *' })).outcome).toBe('ok');
  expect(
    await runtime.db
      .prepare("SELECT 1 FROM session WHERE id='maintenance-probe'")
      .first(),
  ).toBeNull();
  expect(sent).toHaveLength(0);
  expect(await count('push_delivery')).toBe(1);
  await tick();
  expect(sent).toHaveLength(1);
  expect(await count('push_delivery')).toBe(0);
});
it('requires explicit opt-in and authenticates settings, subscriptions and revocation', async () => {
  expect(
    await (await runtime.request('alice', '/api/push/device')).json(),
  ).toMatchObject({
    available: true,
    subscription: null,
    publicKey: vapid.getPublicKey().toString('base64url'),
  });
  await pendingRequest();
  expect(await count('push_delivery')).toBe(0);
  await enable();
  await enable();
  expect(await count('push_subscription')).toBe(1);
  expect(await count('push_delivery')).toBe(0); // No replay of old activity on opt-in.
  for (const method of ['GET', 'PUT', 'DELETE'])
    expect(
      (
        await runtime.request(
          null,
          '/api/push/device',
          method,
          method === 'PUT' ? subscription : undefined,
        )
      ).status,
    ).toBe(401);
  expect(
    (
      await runtime.request('alice', '/api/push/device', 'PUT', subscription, {
        Origin: 'https://elsewhere.test',
      })
    ).status,
  ).toBe(403);
  expect(
    await (await runtime.request('bob', '/api/push/device')).json(),
  ).toMatchObject({ subscription: null });
  await runtime.request('bob', '/api/push/device', 'DELETE', undefined, {
    'X-Push-Endpoint': subscription.endpoint,
  });
  expect(await count('push_subscription')).toBe(1);
  await runtime.request('alice', '/api/push/device', 'DELETE', undefined, {
    'X-Push-Endpoint': subscription.endpoint,
  });
  expect(await count('push_subscription')).toBe(0);
});
it('rejects unsafe endpoints and malformed encryption keys without issuing outbound requests', async () => {
  for (const endpoint of [
    'http://fcm.googleapis.com/x',
    'https://localhost/x',
    'https://127.0.0.1/x',
    'https://fcm.googleapis.com.evil.test/x',
    'https://user:secret@fcm.googleapis.com/x',
    'https://fcm.googleapis.com:444/x',
    'https://fcm.googleapis.com/x#fragment',
  ])
    expect(
      (
        await runtime.request('alice', '/api/push/device', 'PUT', {
          ...subscription,
          endpoint,
        })
      ).status,
    ).toBe(400);
  for (const keys of [
    { p256dh: 'bad', auth: 'bad' },
    {
      p256dh: Buffer.alloc(65).toString('base64url'),
      auth: subscription.keys.auth,
    },
  ])
    expect(
      (
        await runtime.request('alice', '/api/push/device', 'PUT', {
          ...subscription,
          keys,
        })
      ).status,
    ).toBe(400);
  expect(sent).toHaveLength(0);
  expect(await count('push_subscription')).toBe(0);
});
it.each(['request', 'follower'])(
  'delivers an encrypted, signed %s notification with the exact activity identity and leaves it unread',
  async (kind) => {
    await enable();
    await pendingRequest();
    if (kind === 'follower')
      await runtime.db.prepare("UPDATE follow SET status='accepted'").run();
    const receipt = await runtime.db
      .prepare('SELECT version,event_key FROM push_delivery')
      .first<{ version: number; event_key: string }>();
    await enable(); // Registration retries must not discard intervening activity.
    expect(await count('push_delivery')).toBe(1);
    await tick();
    expect(sent).toHaveLength(1);
    expect(sent[0].headers.get('content-encoding')).toBe('aes128gcm');
    const message = JSON.parse(
      decrypt(sent[0].body, {
        version: 'aes128gcm',
        privateKey: browser,
        authSecret: auth,
      }).toString(),
    );
    expect(message).toMatchObject({
      key: `${kind}:bob`,
      version: receipt!.version,
    });
    expect(Object.keys(message).sort()).toEqual([
      'key',
      'subscriptionId',
      'version',
    ]);
    const token = sent[0].headers.get('authorization')!.match(/t=([^,]+)/)![1];
    const [header, payload, signature] = token.split('.');
    const publicBytes = vapid.getPublicKey();
    const key = createPublicKey({
      key: {
        kty: 'EC',
        crv: 'P-256',
        x: publicBytes.subarray(1, 33).toString('base64url'),
        y: publicBytes.subarray(33).toString('base64url'),
      },
      format: 'jwk',
    });
    expect(
      verify(
        'sha256',
        Buffer.from(`${header}.${payload}`),
        { key, dsaEncoding: 'ieee-p1363' },
        Buffer.from(signature, 'base64url'),
      ),
    ).toBe(true);
    expect(
      JSON.parse(Buffer.from(payload, 'base64url').toString()),
    ).toMatchObject({
      aud: 'https://fcm.googleapis.com',
      sub: 'http://localhost:8787',
    });
    expect(await count('push_delivery')).toBe(0);
    expect(
      await runtime.db
        .prepare('SELECT is_read FROM activity_read_state WHERE revision=?')
        .bind(receipt!.version)
        .first('is_read'),
    ).toBe(0);
  },
);
it.each(['removed', 'block', 'inactive', 'expired', 'incomplete'])(
  'cancels follower push when %s before delivery',
  async (reason) => {
    await enable();
    await pendingRequest();
    await runtime.db.prepare("UPDATE follow SET status='accepted'").run();
    expect(await count('push_delivery')).toBe(1);
    if (reason === 'removed')
      await runtime.db.prepare('DELETE FROM follow').run();
    if (reason === 'block')
      await runtime.db
        .prepare("INSERT INTO block VALUES('bob','alice',1)")
        .run();
    if (reason === 'inactive')
      await runtime.db
        .prepare("UPDATE membership SET status='disabled' WHERE user_id='bob'")
        .run();
    if (reason === 'expired')
      await runtime.db
        .prepare("UPDATE session SET expiresAt=0 WHERE id='alice'")
        .run();
    if (reason === 'incomplete')
      await runtime.db.prepare("DELETE FROM avatar WHERE user_id='bob'").run();
    try {
      await tick();
      expect(sent).toHaveLength(0);
      expect(await count('push_delivery')).toBe(0);
    } finally {
      await runtime.db.prepare('DELETE FROM follow').run();
      await seedProfilePhotos(runtime.db);
    }
  },
);
it('queues invitation follower alerts only after profile photo completion and never replays them on replacement', async () => {
  await enable();
  await enable('bob', `${subscription.endpoint}-bob`);
  await runtime.db.batch([
    runtime.db.prepare("DELETE FROM avatar WHERE user_id='bob'"),
    runtime.db.prepare("DELETE FROM profile WHERE user_id='bob'"),
  ]);
  await runtime.request('bob', '/api/people/self', 'PUT', {
    handle: 'bob',
    displayName: 'Bob',
    bio: '',
  });
  expect(await count('push_delivery')).toBe(0);
  await seedProfilePhotos(runtime.db);
  expect(await count('push_delivery')).toBe(2);
  await tick();
  expect(sent).toHaveLength(2);
  const keys = sent.map(
    (item) =>
      JSON.parse(
        decrypt(item.body, {
          version: 'aes128gcm',
          privateKey: browser,
          authSecret: auth,
        }).toString(),
      ).key,
  );
  expect(keys.sort()).toEqual(['follower:alice', 'follower:bob']);
  await runtime.db
    .prepare("UPDATE avatar SET object_key='replacement' WHERE user_id='bob'")
    .run();
  expect(await count('push_delivery')).toBe(0);
});
it('coalesces likes and concurrent dispatchers, and prevents a stale completion from clearing a newer version', async () => {
  await enable();
  await photo();
  await runtime.db
    .prepare("INSERT INTO post_like VALUES('photo','bob',1000)")
    .run();
  await runtime.db
    .prepare("INSERT INTO post_like VALUES('photo','carol',1000)")
    .run();
  expect(await count('push_delivery')).toBe(1);
  await runtime.db.prepare('UPDATE push_delivery SET available_at=0').run();
  let entered!: () => void;
  const sending = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  pauseSend = async () => {
    entered();
    await held;
  };
  const first = tick();
  await sending;
  await tick();
  expect(sent).toHaveLength(1);
  await runtime.db
    .prepare("INSERT INTO post_like VALUES('photo','david',1000)")
    .run();
  release();
  await first;
  pauseSend = undefined;
  expect(await count('push_delivery')).toBe(1);
  await runtime.db.prepare('UPDATE push_delivery SET available_at=0').run();
  await tick();
  expect(sent).toHaveLength(2);
  expect(await count('push_delivery')).toBe(0);
  expect(sent[0].headers.get('topic')).toBe(sent[1].headers.get('topic'));
});
it('retries transient and ambiguous failures with a lease, honors Retry-After, and removes expired subscriptions', async () => {
  await enable();
  await pendingRequest();
  responseStatus = 429;
  responseHeaders = { 'Retry-After': '600' };
  const before = Date.now();
  await tick();
  const retry = await runtime.db
    .prepare('SELECT attempts,available_at,lease FROM push_delivery')
    .first<{ attempts: number; available_at: number; lease: string | null }>();
  expect(retry!.attempts).toBe(1);
  expect(retry!.available_at).toBeGreaterThanOrEqual(before + 600000);
  expect(retry!.lease).toBeNull();
  await tick();
  expect(sent).toHaveLength(1);
  responseStatus = 410;
  await runtime.db.prepare('UPDATE push_delivery SET available_at=0').run();
  await tick();
  expect(await count('push_subscription')).toBe(0);
  expect(await count('push_delivery')).toBe(0);
});
it('seeks older push targets without marking them read and rechecks ownership and blocks', async () => {
  await photo();
  for (let i = 1; i <= 25; i++)
    await runtime.db
      .prepare(
        "INSERT INTO comment(id,post_id,user_id,body,created_at) VALUES(?,'photo','bob','Synthetic',?)",
      )
      .bind(`comment-${i}`, i)
      .run();
  const page = (await (
    await runtime.request('alice', '/api/notifications?focus=comment:comment-1')
  ).json()) as {
    focusFound: boolean;
    items: { key: string; unread: boolean }[];
  };
  expect(page.focusFound).toBe(true);
  expect(page.items[0]).toMatchObject({
    key: 'comment:comment-1',
    unread: true,
  });
  expect(
    await (
      await runtime.request(
        'carol',
        '/api/notifications?focus=comment:comment-1',
      )
    ).json(),
  ).toMatchObject({ focusFound: false, items: [] });
  await runtime.db.prepare("INSERT INTO block VALUES('bob','alice',1)").run();
  expect(
    await (
      await runtime.request(
        'alice',
        '/api/notifications?focus=comment:comment-1',
      )
    ).json(),
  ).toMatchObject({ focusFound: false, items: [] });
  expect(
    (
      await runtime.request(
        'alice',
        '/api/notifications?focus=https://elsewhere.test',
      )
    ).status,
  ).toBe(400);
});
it('recovers an expired claim, limits attempts, and never follows provider redirects', async () => {
  await enable();
  await pendingRequest();
  await runtime.db
    .prepare("UPDATE push_delivery SET lease='interrupted',lease_until=?")
    .bind(Date.now() + 60000)
    .run();
  await tick();
  expect(sent).toHaveLength(0);
  await runtime.db.prepare('UPDATE push_delivery SET lease_until=0').run();
  responseStatus = 302;
  responseHeaders = { Location: 'https://elsewhere.test/steal' };
  await tick();
  expect(sent).toHaveLength(1);
  expect(await count('push_delivery')).toBe(0);
  await runtime.db.prepare('DELETE FROM follow').run();
  await pendingRequest();
  await runtime.db.prepare('UPDATE push_delivery SET attempts=8').run();
  await tick();
  expect(sent).toHaveLength(1);
  expect(await count('push_delivery')).toBe(0);
});
it('rolls back the source mutation when its delivery intent cannot commit', async () => {
  await enable();
  await runtime.db.exec(
    "CREATE TRIGGER fail_push BEFORE INSERT ON push_delivery BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;",
  );
  try {
    await expect(pendingRequest()).rejects.toThrow('synthetic failure');
    expect(
      await runtime.db
        .prepare(
          "SELECT COUNT(*) AS n FROM follow WHERE follower_id='bob' AND target_id='alice'",
        )
        .first('n'),
    ).toBe(0);
    expect(await count('push_delivery')).toBe(0);
  } finally {
    await runtime.db.exec('DROP TRIGGER fail_push');
  }
});
it('keeps isolated installations sharing a copied session independent and protects endpoint ownership', async () => {
  const device = '/api/push/device';
  const one = { ...subscription, endpoint: subscription.endpoint + '/one' };
  const two = { ...subscription, endpoint: subscription.endpoint + '/two' };
  for (const value of [one, two, one])
    expect((await runtime.request('alice', device, 'PUT', value)).status).toBe(
      200,
    );
  expect(await count('push_subscription')).toBe(2);
  expect(await (await runtime.request('alice', device)).json()).toMatchObject({
    subscription: null,
  });
  const headers = { 'X-Push-Endpoint': one.endpoint };
  expect(
    await (
      await runtime.request('alice', device, 'GET', undefined, headers)
    ).json(),
  ).toMatchObject({ subscription: { endpoint: one.endpoint } });
  expect(
    await (
      await runtime.request('bob', device, 'GET', undefined, headers)
    ).json(),
  ).toMatchObject({ subscription: null });
  expect((await runtime.request('bob', device, 'PUT', one)).status).toBe(409);
  await runtime.request('bob', device, 'DELETE', undefined, headers);
  expect(await count('push_subscription')).toBe(2);
  // An old open client cannot replace or revoke multiple installations.
  expect(
    (await runtime.request('alice', '/api/push', 'PUT', subscription)).status,
  ).toBe(409);
  expect((await runtime.request('alice', '/api/push', 'DELETE')).status).toBe(
    409,
  );
  expect(await count('push_subscription')).toBe(2);
  await pendingRequest();
  expect(await count('push_delivery')).toBe(2);
  await runtime.request('alice', device, 'PUT', one);
  expect(await count('push_delivery')).toBe(2);
  await runtime.request('alice', device, 'DELETE', undefined, headers);
  expect(await count('push_subscription')).toBe(1);
  expect(await count('push_delivery')).toBe(1);
  expect(
    await (
      await runtime.request('alice', device, 'GET', undefined, {
        'X-Push-Endpoint': two.endpoint,
      })
    ).json(),
  ).toMatchObject({ subscription: { endpoint: two.endpoint } });
});
it('atomically enforces the per-member cap across installations without preventing idempotent registration', async () => {
  const attempts = Array.from({ length: 12 }, (_, i) => ({
    ...subscription,
    endpoint: subscription.endpoint + '/' + i,
  }));
  const responses = await Promise.all(
    attempts.map((value) =>
      runtime.request('alice', '/api/push/device', 'PUT', value),
    ),
  );
  expect(responses.filter((response) => response.status === 200)).toHaveLength(
    10,
  );
  expect(responses.filter((response) => response.status === 409)).toHaveLength(
    2,
  );
  expect(await count('push_subscription')).toBe(10);
  const accepted =
    attempts[responses.findIndex((response) => response.status === 200)];
  expect(
    (await runtime.request('alice', '/api/push/device', 'PUT', accepted))
      .status,
  ).toBe(200);
  expect(await count('push_subscription')).toBe(10);
  await pendingRequest();
  expect(await count('push_delivery')).toBe(10);
  // All copies of this login are revoked together; session ownership is unchanged.
  await runtime.db
    .prepare("UPDATE session SET expiresAt=0 WHERE id='alice'")
    .run();
  expect((await runtime.request('alice', '/api/push/device')).status).toBe(401);
  await tick();
  expect(sent).toHaveLength(0);
  await runtime.db
    .prepare(
      'INSERT INTO session(id,userId,token,expiresAt,createdAt,updatedAt) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET expiresAt=excluded.expiresAt',
    )
    .bind('alice', 'alice', 'alice-token', Date.now() + 86400000, 1, 1)
    .run();
});

it('revokes every installation sharing a cookie through library sign-out while preserving other sign-ins', async () => {
  await runtime.db
    .prepare(
      'INSERT INTO session(id,userId,token,expiresAt,createdAt,updatedAt) VALUES(?,?,?,?,?,?)',
    )
    .bind('copied', 'alice', 'copied-token', Date.now() + 86400000, 1, 1)
    .run();
  await enable();
  expect(
    (await runtime.request('copied', '/api/push/device', 'PUT', subscription))
      .status,
  ).toBe(409);
  expect(
    await (
      await runtime.request('copied', '/api/push/device', 'GET', undefined, {
        'X-Push-Endpoint': subscription.endpoint,
      })
    ).json(),
  ).toMatchObject({ subscription: null });
  await runtime.request('copied', '/api/push/device', 'DELETE', undefined, {
    'X-Push-Endpoint': subscription.endpoint,
  });
  expect(await count('push_subscription')).toBe(1);

  for (const suffix of ['one', 'two'])
    expect(
      (
        await runtime.request('copied', '/api/push/device', 'PUT', {
          ...subscription,
          endpoint: subscription.endpoint + '/' + suffix,
        })
      ).status,
    ).toBe(200);
  await pendingRequest();
  expect(await count('push_delivery')).toBe(3);
  expect(
    (await runtime.request('copied', '/api/auth/sign-out', 'POST', {})).status,
  ).toBe(200);
  expect(await count('push_subscription')).toBe(1);
  expect(await count('push_delivery')).toBe(1);
  expect(
    await (
      await runtime.request('alice', '/api/push/device', 'GET', undefined, {
        'X-Push-Endpoint': subscription.endpoint,
      })
    ).json(),
  ).toMatchObject({ subscription: { endpoint: subscription.endpoint } });
});
it('revokes the device subscription and queued alerts through real library sign-out', async () => {
  await enable('bob');
  await runtime.db
    .prepare("INSERT INTO follow VALUES('alice','bob','pending',1000)")
    .run();
  expect(await count('push_delivery')).toBe(1);
  expect(
    (await runtime.request('bob', '/api/auth/sign-out', 'POST', {})).status,
  ).toBe(200);
  expect(await count('push_subscription')).toBe(0);
  expect(await count('push_delivery')).toBe(0);
  await tick();
  expect(sent).toHaveLength(0);
});
it.each([
  'read',
  'deny',
  'block',
  'inactive',
  'expired',
  'disable',
  'delete',
] as const)('does not deliver after %s', async (reason) => {
  await enable();
  await pendingRequest();
  const row = await runtime.db
    .prepare('SELECT event_key AS key,version FROM push_delivery')
    .first();
  if (reason === 'read')
    await runtime.request('alice', '/api/notifications/read', 'POST', {
      items: [row],
    });
  if (reason === 'deny') await runtime.db.prepare('DELETE FROM follow').run();
  if (reason === 'block')
    await runtime.db.prepare("INSERT INTO block VALUES('bob','alice',1)").run();
  if (reason === 'inactive')
    await runtime.db
      .prepare("UPDATE membership SET status='disabled' WHERE user_id='bob'")
      .run();
  if (reason === 'expired')
    await runtime.db
      .prepare("UPDATE session SET expiresAt=0 WHERE id='alice'")
      .run();
  if (reason === 'disable')
    await runtime.request('alice', '/api/push/device', 'DELETE', undefined, {
      'X-Push-Endpoint': subscription.endpoint,
    });
  if (reason === 'delete')
    await runtime.request('alice', '/api/me', 'DELETE', {
      confirmation: 'DELETE',
    });
  await tick();
  expect(sent).toHaveLength(0);
  expect(await count('push_delivery')).toBe(0);
});
