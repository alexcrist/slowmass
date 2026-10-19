import { afterEach, beforeEach, expect, it } from 'vitest';
import { createECDH, randomBytes } from 'node:crypto';
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
const device = createECDH('prime256v1');
device.generateKeys();
const auth = randomBytes(16);
let runtime: Awaited<ReturnType<typeof testRuntime>>;
let sent: Buffer[];
let providerStatus: number;
beforeEach(async () => {
  sent = [];
  providerStatus = 201;
  runtime = await testRuntime(false, false, undefined, {
    publicKey: vapid.getPublicKey().toString('base64url'),
    privateKey: vapid.getPrivateKey().toString('base64url'),
    send: async (request) => {
      sent.push(Buffer.from(await request.arrayBuffer()));
      return { status: providerStatus };
    },
  });
  for (const id of ['alice', 'bob'])
    await runtime.request(id, '/api/people/self', 'PUT', {
      handle: id,
      displayName: id,
      bio: '',
    });
  await seedProfilePhotos(runtime.db);
  // Event-only members can answer and receive push without a profile photo.
  await runtime.db.prepare("DELETE FROM avatar WHERE user_id='bob'").run();
});
afterEach(async () => runtime?.worker.dispose());

async function event() {
  const id = crypto.randomUUID();
  const details = {
    title: 'Private dinner',
    description: 'Private description',
    location: 'Private location',
    startsAt: Date.now() + 86400000,
    endsAt: null,
    timeZone: 'UTC',
  };
  expect(
    (await runtime.request('alice', '/api/events', 'POST', { id, ...details }))
      .status,
  ).toBe(200);
  // Image processing is covered separately; publish this synthetic fixture.
  await runtime.db
    .prepare(
      "UPDATE event SET state='published',object_key='events/'||id||'.webp',thumbnail_key='events/'||id||'.webp',width=4,height=3 WHERE id=?",
    )
    .bind(id)
    .run();
  const { event: published } = (await (
    await runtime.request('alice', `/api/events/${id}`)
  ).json()) as { event: { url: string } };
  const token = published.url.split('#event/')[1];
  expect(
    (await runtime.request('bob', '/api/events/open', 'POST', { token }))
      .status,
  ).toBe(200);
  return { id, details, token };
}
async function answer(id: string) {
  expect(
    (
      await runtime.request('bob', `/api/events/${id}/response`, 'POST', {
        status: 'going',
      })
    ).status,
  ).toBe(200);
}
async function enable(actor: string) {
  expect(
    (
      await runtime.request(actor, '/api/push/device', 'PUT', {
        endpoint: 'https://fcm.googleapis.com/fcm/send/synthetic-event',
        keys: {
          p256dh: device.getPublicKey().toString('base64url'),
          auth: auth.toString('base64url'),
        },
      })
    ).status,
  ).toBe(200);
}
async function queued() {
  return runtime.db
    .prepare('SELECT COUNT(*) AS n FROM push_delivery')
    .first('n');
}

it.each(['response', 'message', 'notification', 'cancel'])(
  'dispatches event %s immediately with its exact unread Activity identity',
  async (kind) => {
    const { id } = await event();
    if (kind !== 'response') await answer(id);
    const recipient = kind === 'response' ? 'alice' : 'bob';
    await enable(recipient);
    const messageId = crypto.randomUUID();
    const key =
      kind === 'response'
        ? `event_response:${id}.bob`
        : `event_message:${messageId}`;
    if (kind === 'response') await answer(id);
    else {
      const response = await runtime.request(
        'alice',
        `/api/events/${id}/${kind === 'notification' ? 'notifications' : kind === 'cancel' ? 'cancel' : 'messages'}`,
        'POST',
        kind === 'cancel'
          ? { messageId }
          : { id: messageId, body: 'Private message' },
      );
      expect(response.status).toBe(200);
    }
    // No scheduled invocation: the mutation must start dispatch itself.
    await expect.poll(() => sent.length, { timeout: 5000 }).toBe(1);
    await expect.poll(queued, { timeout: 5000 }).toBe(0);
    const payload = JSON.parse(
      decrypt(sent[0], {
        version: 'aes128gcm',
        privateKey: device,
        authSecret: auth,
      }).toString(),
    ) as { key: string; version: number; subscriptionId: string };
    expect(payload).toEqual({
      key,
      version: expect.any(Number),
      subscriptionId: expect.any(String),
    });
    expect(
      await (
        await runtime.request(
          recipient,
          `/api/notifications?includeEvents=1&focus=${key}`,
        )
      ).json(),
    ).toMatchObject({
      focusFound: true,
      items: [
        expect.objectContaining({
          key,
          version: payload.version,
          unread: true,
        }),
      ],
    });
  },
);

it.each(['read', 'block', 'delete'])(
  'rechecks event %s state before retrying a failed immediate send',
  async (reason) => {
    const { id } = await event();
    await answer(id);
    await enable('bob');
    providerStatus = 503;
    const messageId = crypto.randomUUID();
    expect(
      (
        await runtime.request(
          'alice',
          `/api/events/${id}/notifications`,
          'POST',
          {
            id: messageId,
            body: 'Private message',
          },
        )
      ).status,
    ).toBe(200);
    await expect
      .poll(
        async () =>
          runtime.db
            .prepare('SELECT attempts FROM push_delivery WHERE lease IS NULL')
            .first('attempts'),
        { timeout: 5000 },
      )
      .toBe(1);
    const receipt = await runtime.db
      .prepare('SELECT event_key AS key,version FROM push_delivery')
      .first();
    if (reason === 'read')
      expect(
        (
          await runtime.request('bob', '/api/notifications/read', 'POST', {
            items: [receipt],
          })
        ).status,
      ).toBe(200);
    else if (reason === 'delete')
      expect(
        (await runtime.request('alice', `/api/events/${id}`, 'DELETE')).status,
      ).toBe(200);
    else
      await runtime.db
        .prepare("INSERT INTO block VALUES('bob','alice',1)")
        .run();
    providerStatus = 201;
    await runtime.db.prepare('UPDATE push_delivery SET available_at=0').run();
    expect(
      (
        await (
          await runtime.worker.getWorker()
        ).scheduled({ cron: '0 * * * *' })
      ).outcome,
    ).toBe('ok');
    expect(sent).toHaveLength(1);
    expect(await queued()).toBe(0);
  },
);

it('keeps detail edits silent and discards historical change alerts before delivery', async () => {
  const { id, details } = await event();
  await answer(id);
  await enable('bob');
  expect(
    (
      await runtime.request('alice', `/api/events/${id}`, 'PATCH', {
        ...details,
        startsAt: details.startsAt + 3600000,
        location: 'New location',
      })
    ).status,
  ).toBe(200);
  expect(await queued()).toBe(0);
  expect(sent).toHaveLength(0);
  await runtime.db
    .prepare(
      "INSERT INTO event_message(id,event_id,user_id,kind,body,created_at) VALUES(?,?,'alice','changed','time',?)",
    )
    .bind(crypto.randomUUID(), id, Date.now())
    .run();
  expect(await queued()).toBe(1);
  expect(
    (await (await runtime.worker.getWorker()).scheduled({ cron: '0 * * * *' }))
      .outcome,
  ).toBe('ok');
  expect(await queued()).toBe(0);
  expect(sent).toHaveLength(0);
});

it('adds Activity for every guest while only sending push to opted-in devices, without replaying retries', async () => {
  const { id, token } = await event();
  await answer(id);
  await runtime.request('carol', '/api/people/self', 'PUT', {
    handle: 'carol',
    displayName: 'Carol',
    bio: '',
  });
  await runtime.request('carol', '/api/events/open', 'POST', { token });
  await runtime.request('carol', `/api/events/${id}/response`, 'POST', {
    status: 'declined',
  });
  await enable('bob');
  const input = { id: crypto.randomUUID(), body: 'Bring a jacket' };
  const path = `/api/events/${id}/notifications`;
  expect((await runtime.request('alice', path, 'POST', input)).status).toBe(
    200,
  );
  await expect.poll(() => sent.length, { timeout: 5000 }).toBe(1);
  await expect.poll(queued, { timeout: 5000 }).toBe(0);
  for (const actor of ['bob', 'carol'])
    expect(
      await (
        await runtime.request(actor, '/api/notifications?includeEvents=1')
      ).json(),
    ).toMatchObject({
      items: [
        expect.objectContaining({
          key: `event_message:${input.id}`,
          body: input.body,
          unread: true,
        }),
      ],
    });
  expect((await runtime.request('alice', path, 'POST', input)).status).toBe(
    200,
  );
  expect(sent).toHaveLength(1);
  expect(await queued()).toBe(0);
});
