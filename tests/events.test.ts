import { afterEach, beforeEach, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { unstable_splitSqlQuery } from 'wrangler';
import { testRuntime, seedProfilePhotos } from './support/runtime';
import { cleanupAccounts } from '../src/server/features/account';
import { cleanupEvents } from '../src/server/features/events';

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
  for (const id of ['alice', 'bob', 'carol', 'david'])
    await runtime.request(id, '/api/people/self', 'PUT', {
      handle: id,
      displayName: id[0].toUpperCase() + id.slice(1),
      bio: '',
    });
  await seedProfilePhotos(runtime.db);
  // David finished his name but not his photo, like a member mid-setup.
  await runtime.db.batch([
    runtime.db.prepare('DELETE FROM follow'),
    runtime.db.prepare("DELETE FROM avatar WHERE user_id='david'"),
  ]);
});
afterEach(async () => {
  await runtime?.worker.dispose();
});

function details(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Dinner',
    description: 'Bring a dish',
    location: '1 Main St',
    startsAt: Date.now() + day,
    endsAt: null,
    timeZone: 'America/Los_Angeles',
    ...overrides,
  };
}
async function draft(actor = 'alice', input = details()) {
  const id = crypto.randomUUID();
  const response = await runtime.request(actor, '/api/events', 'POST', {
    id,
    ...input,
  });
  return { id, response };
}
// Photo processing has its own test; most tests publish the draft directly.
async function publish(id: string) {
  await runtime.db
    .prepare(
      "UPDATE event SET state='published',object_key='events/'||id||'.webp',thumbnail_key='events/'||id||'-thumb.webp',width=4,height=3 WHERE id=?",
    )
    .bind(id)
    .run();
}
// The event's one URL, from the event view of anyone who can see it.
async function link(id: string, actor = 'alice') {
  const response = await runtime.request(actor, `/api/events/${id}`);
  if (response.status !== 200) return null;
  const { event } = (await response.json()) as {
    event: { link: { id: string; url: string } | null };
  };
  if (!event.link) return null;
  const { id: linkId, url } = event.link;
  return { id: linkId, url, token: url.split('#event/')[1] };
}
async function event(input = details()) {
  const { id } = await draft('alice', input);
  await publish(id);
  const { token, url } = (await link(id))!;
  return { id, token, url };
}
async function open(actor: string, token: string) {
  return runtime.request(actor, '/api/events/open', 'POST', { token });
}
// Answering through a link first opens it, as the app does.
async function respond(
  actor: string,
  id: string,
  status: string,
  token?: string,
) {
  if (token) await open(actor, token);
  return runtime.request(actor, `/api/events/${id}/response`, 'POST', {
    status,
  });
}
async function check(token: string) {
  return (
    (await (
      await runtime.request(null, '/api/event-link', 'POST', { token })
    ).json()) as { event: { id: string; open: boolean } | null }
  ).event;
}
type Activity = {
  key: string;
  kind: string;
  version: number;
  unread: boolean;
  eventId: string | null;
  eventTitle: string | null;
  response: string | null;
  messageKind: string | null;
  handle: string | null;
  displayName: string | null;
  body: string | null;
};
async function activity(actor: string, events = true) {
  const response = await runtime.request(
    actor,
    `/api/notifications?includeJoined=1${events ? '&includeEvents=1' : ''}`,
  );
  return ((await response.json()) as { items: Activity[] }).items;
}
async function unread(actor: string, events = true) {
  return (
    (await (
      await runtime.request(
        actor,
        `/api/notifications/unread-count?includeJoined=1${events ? '&includeEvents=1' : ''}`,
      )
    ).json()) as { count: number }
  ).count;
}
async function message(actor: string, id: string, body: string) {
  const messageId = crypto.randomUUID();
  const response = await runtime.request(
    actor,
    `/api/events/${id}/messages`,
    'POST',
    { id: messageId, body },
  );
  return { messageId, response };
}

it('creates events idempotently for members with a profile photo', async () => {
  expect((await draft('david')).response.status).toBe(409);
  const input = details();
  const id = crypto.randomUUID();
  const create = (actor: string, body: Record<string, unknown>) =>
    runtime.request(actor, '/api/events', 'POST', { id, ...body });
  expect(await (await create('alice', input)).json()).toEqual({
    id,
    state: 'pending',
  });
  expect(await (await create('alice', input)).json()).toEqual({
    id,
    state: 'pending',
  });
  expect((await create('alice', { ...input, title: 'Lunch' })).status).toBe(
    409,
  );
  expect((await create('bob', input)).status).toBe(409);
  for (const invalid of [
    { title: '' },
    { title: 'x'.repeat(121) },
    { timeZone: 'Mars/Base' },
    { endsAt: input.startsAt },
    { endsAt: input.startsAt + 31 * day },
    { startsAt: 1.5 },
  ])
    expect(
      (
        await runtime.request('alice', '/api/events', 'POST', {
          id: crypto.randomUUID(),
          ...input,
          ...invalid,
        })
      ).status,
    ).toBe(400);
  // A draft waits for its photo before anyone, including the host, can open it.
  expect((await runtime.request('alice', `/api/events/${id}`)).status).toBe(
    404,
  );
  expect(await link(id)).toBeNull();
  await publish(id);
  expect(
    await (await runtime.request('alice', `/api/events/${id}`)).json(),
  ).toMatchObject({
    event: {
      id,
      title: 'Dinner',
      cancelled: false,
      over: false,
      hosts: [{ handle: 'alice', displayName: 'Alice', hasAvatar: true }],
      counts: { going: 0, maybe: 0, declined: 0 },
      viewer: { isHost: true, isCreator: true, response: null },
    },
  });
  for (let index = 1; index < 10; index++)
    expect((await draft()).response.status).toBe(200);
  expect((await draft()).response.status).toBe(429);
});

it('shows the event only after sign-in, and guests only after answering', async () => {
  const { id, token, url } = await event();
  expect(new URL(url).pathname).toBe('/');
  expect(new URL(url).search).toBe('');
  expect(new URL(url).hash).toBe(`#event/${token}`);
  // Signed out, a link reveals only whether it works.
  expect(await check(token)).toEqual({ id, open: true });
  expect(await check('x'.repeat(48))).toBeNull();
  expect(await link(id, 'bob')).toBeNull();
  expect((await runtime.request('bob', `/api/events/${id}`)).status).toBe(404);
  expect((await open('bob', 'x'.repeat(48))).status).toBe(404);
  expect(await (await open('bob', token)).json()).toEqual({ id });
  const opened = await runtime.db
    .prepare("SELECT link_id FROM event_access WHERE user_id='bob'")
    .first('link_id');
  expect(opened).toBe((await link(id))!.id);
  // Opening shows details and the URL, but not who answered.
  expect(
    await (await runtime.request('bob', `/api/events/${id}`)).json(),
  ).toMatchObject({
    event: {
      id,
      title: 'Dinner',
      counts: null,
      link: { url },
      viewer: { isHost: false, response: null },
    },
  });
  expect(
    await (
      await runtime.request('bob', `/api/events/${id}/guests?status=going`)
    ).json(),
  ).toEqual({ items: [], next: null });
  expect(
    await (await runtime.request('bob', `/api/events/${id}/activity`)).json(),
  ).toEqual({ items: [], next: null });
  expect((await message('bob', id, 'Hi')).response.status).toBe(409);
  // Hosts open their own link without a record.
  expect(await (await open('alice', token)).json()).toEqual({ id });
  expect(
    await runtime.db
      .prepare("SELECT 1 FROM event_access WHERE user_id='alice'")
      .first(),
  ).toBeNull();

  const bucket = await runtime.worker.getR2Bucket('PHOTOS');
  await bucket.put(`events/${id}.webp`, new Uint8Array([1, 2, 3]));
  const media = (actor: string | null, headers = {}) =>
    runtime.request(actor, `/media/events/${id}`, 'GET', undefined, headers);
  expect((await media('bob')).status).toBe(200);
  expect((await media('alice')).status).toBe(200);
  expect((await media('carol')).status).toBe(404);
  expect((await media(null)).status).toBe(404);
  // The credential never authorizes anything without a session.
  expect((await media(null, { 'X-Event-Link': token })).status).toBe(404);

  // Replacing the link cuts off people who only opened it, not those who
  // answered.
  await respond('carol', id, 'going', token);
  const current = (await link(id))!;
  const replacement = crypto.randomUUID();
  const replace = () =>
    runtime.request('alice', `/api/events/${id}/link`, 'POST', {
      id: replacement,
      expectedId: current.id,
    });
  const replaced = (await (await replace()).json()) as {
    link: { id: string; url: string };
  };
  expect(replaced.link.id).toBe(replacement);
  expect(await (await replace()).json()).toEqual(replaced);
  expect(
    (
      await runtime.request('alice', `/api/events/${id}/link`, 'POST', {
        id: crypto.randomUUID(),
        expectedId: current.id,
      })
    ).status,
  ).toBe(409);
  expect(await check(token)).toBeNull();
  expect((await runtime.request('bob', `/api/events/${id}`)).status).toBe(404);
  expect((await media('bob')).status).toBe(404);
  expect((await open('bob', token)).status).toBe(404);
  expect((await runtime.request('carol', `/api/events/${id}`)).status).toBe(
    200,
  );
  expect((await link(id, 'carol'))!.url).toBe(replaced.link.url);
  const fresh = replaced.link.url.split('#event/')[1];
  expect(await (await open('bob', fresh)).json()).toEqual({ id });
  expect(
    await runtime.db
      .prepare("SELECT link_id FROM event_access WHERE user_id='bob'")
      .first('link_id'),
  ).toBe(replacement);
});

it('admits answers through the current link and keeps them without it', async () => {
  const { id, token } = await event();
  expect((await respond('bob', id, 'going')).status).toBe(409);
  expect((await respond('bob', id, 'yes', token)).status).toBe(400);
  expect((await respond('bob', id, 'going', token)).status).toBe(200);
  expect(
    await (await runtime.request('bob', `/api/events/${id}`)).json(),
  ).toMatchObject({
    event: {
      counts: { going: 1, maybe: 0, declined: 0 },
      viewer: { isHost: false, isCreator: false, response: 'going' },
    },
  });
  expect((await respond('bob', id, 'maybe')).status).toBe(200);
  expect((await respond('alice', id, 'going', token)).status).toBe(409);
  // Members without a profile photo can still answer events.
  expect((await respond('david', id, 'declined', token)).status).toBe(200);
  expect(
    await (
      await runtime.request('alice', `/api/events/${id}/guests?status=maybe`)
    ).json(),
  ).toEqual({
    items: [{ handle: 'bob', displayName: 'Bob', hasAvatar: true }],
    next: null,
  });
  expect(
    await (
      await runtime.request('bob', `/api/events/${id}/guests?status=declined`)
    ).json(),
  ).toEqual({
    items: [{ handle: 'david', displayName: 'David', hasAvatar: false }],
    next: null,
  });
  // Blocks with the creator deny the event; other blocks hide the person.
  await runtime.db.prepare("INSERT INTO block VALUES('alice','carol',1)").run();
  expect((await open('carol', token)).status).toBe(404);
  expect((await respond('carol', id, 'going', token)).status).toBe(409);
  await runtime.db.prepare("INSERT INTO block VALUES('bob','david',1)").run();
  expect(
    await (
      await runtime.request('bob', `/api/events/${id}/guests?status=declined`)
    ).json(),
  ).toEqual({ items: [], next: null });
  expect(
    await (await runtime.request('bob', `/api/events/${id}`)).json(),
  ).toMatchObject({ event: { counts: { going: 0, maybe: 1, declined: 0 } } });
  await runtime.db.prepare('DELETE FROM block').run();
  await runtime.db.prepare("INSERT INTO block VALUES('bob','alice',1)").run();
  expect((await runtime.request('bob', `/api/events/${id}`)).status).toBe(404);
  await runtime.db.prepare('DELETE FROM block').run();

  // Inactive guests disappear; disabled creators take the event with them.
  await runtime.db
    .prepare("UPDATE membership SET status='disabled' WHERE user_id='david'")
    .run();
  expect(
    await (
      await runtime.request('bob', `/api/events/${id}/guests?status=declined`)
    ).json(),
  ).toEqual({ items: [], next: null });
  await runtime.db
    .prepare("UPDATE membership SET status='disabled' WHERE user_id='alice'")
    .run();
  expect((await runtime.request('bob', `/api/events/${id}`)).status).toBe(404);
  expect(await check(token)).toBeNull();
  await runtime.db.prepare("UPDATE membership SET status='active'").run();

  const cancelId = crypto.randomUUID();
  expect(
    (
      await runtime.request('bob', `/api/events/${id}/cancel`, 'POST', {
        messageId: cancelId,
      })
    ).status,
  ).toBe(404);
  for (let attempt = 0; attempt < 2; attempt++)
    expect(
      (
        await runtime.request('alice', `/api/events/${id}/cancel`, 'POST', {
          messageId: cancelId,
        })
      ).status,
    ).toBe(200);
  expect((await respond('bob', id, 'going')).status).toBe(409);
  expect(
    await (await runtime.request('bob', `/api/events/${id}`)).json(),
  ).toMatchObject({ event: { cancelled: true } });
});

it('closes answers when the event is over and lists upcoming and past events', async () => {
  const past = await event(
    details({ title: 'Brunch', startsAt: Date.now() - 13 * 3600000 }),
  );
  const ended = await event(
    details({
      title: 'Picnic',
      startsAt: Date.now() - 3 * 3600000,
      endsAt: Date.now() - 3600000,
    }),
  );
  const soon = await event(
    details({ title: 'Movie', startsAt: Date.now() + day }),
  );
  const later = await event(
    details({ title: 'Hike', startsAt: Date.now() + 3 * day }),
  );
  const tonight = await event(
    details({ title: 'Party', startsAt: Date.now() - 3600000 }),
  );
  expect((await respond('bob', past.id, 'going', past.token)).status).toBe(409);
  expect((await respond('bob', ended.id, 'going', ended.token)).status).toBe(
    409,
  );
  expect((await respond('bob', later.id, 'maybe', later.token)).status).toBe(
    200,
  );
  expect(
    (await respond('bob', tonight.id, 'going', tonight.token)).status,
  ).toBe(200);
  const titles = async (actor: string, when: string) =>
    (
      (await (
        await runtime.request(actor, `/api/events?when=${when}`)
      ).json()) as { items: { title: string }[] }
    ).items.map((item) => item.title);
  expect(await titles('alice', 'upcoming')).toEqual(['Party', 'Movie', 'Hike']);
  expect(await titles('alice', 'past')).toEqual(['Picnic', 'Brunch']);
  expect(await titles('bob', 'upcoming')).toEqual(['Party', 'Hike']);
  // Opened events are listed too, even when answering failed.
  expect(await titles('bob', 'past')).toEqual(['Picnic', 'Brunch']);
  expect((await runtime.request('alice', '/api/events?when=soon')).status).toBe(
    400,
  );
  void soon;
});

it('pages events and their merged answers and messages', async () => {
  const { id, token } = await event();
  // Older creations keep these within the daily creation allowance.
  for (let index = 0; index < 22; index++) {
    const extra = await draft(
      'alice',
      details({ startsAt: Date.now() + (index + 2) * day }),
    );
    await publish(extra.id);
    await runtime.db
      .prepare('UPDATE event SET created_at=0 WHERE id=?')
      .bind(extra.id)
      .run();
  }
  const first = (await (
    await runtime.request('alice', '/api/events')
  ).json()) as { items: { id: string }[]; next: string | null };
  expect(first.items).toHaveLength(20);
  const second = (await (
    await runtime.request(
      'alice',
      `/api/events?cursor=${encodeURIComponent(first.next!)}`,
    )
  ).json()) as { items: { id: string }[]; next: string | null };
  expect(second.items).toHaveLength(3);
  expect(second.next).toBeNull();
  expect(first.items[0].id).toBe(id);

  await respond('bob', id, 'going', token);
  const posted: string[] = [];
  for (let index = 0; index < 22; index++) {
    const { messageId, response } = await message(
      'alice',
      id,
      `Update ${index}`,
    );
    expect(response.status).toBe(200);
    posted.push(messageId);
  }
  const log = async (cursor?: string) =>
    (await (
      await runtime.request(
        'bob',
        `/api/events/${id}/activity${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
      )
    ).json()) as {
      items: {
        kind: string;
        body: string;
        handle: string;
        status: string | null;
        canDelete: boolean;
      }[];
      next: string | null;
    };
  const page = await log();
  expect(page.items).toHaveLength(20);
  expect(page.items[0]).toMatchObject({
    kind: 'message',
    body: 'Update 21',
    handle: 'alice',
    canDelete: false,
  });
  const rest = await log(page.next!);
  expect(rest.items.map((item) => item.kind)).toEqual([
    'message',
    'message',
    'response',
  ]);
  expect(rest.items.at(-1)).toMatchObject({ handle: 'bob', status: 'going' });
  expect(rest.next).toBeNull();
});

it('posts, retries and removes messages for hosts and guests only', async () => {
  const { id, token } = await event();
  await respond('bob', id, 'going', token);
  await respond('carol', id, 'maybe', token);
  expect((await message('david', id, 'Hi')).response.status).toBe(409);
  expect((await message('bob', id, ' ')).response.status).toBe(400);
  const { messageId, response } = await message('bob', id, 'See you there');
  expect(response.status).toBe(200);
  const retry = () =>
    runtime.request('bob', `/api/events/${id}/messages`, 'POST', {
      id: messageId,
      body: 'See you there',
    });
  expect((await retry()).status).toBe(200);
  expect(
    (
      await runtime.request('bob', `/api/events/${id}/messages`, 'POST', {
        id: messageId,
        body: 'Different',
      })
    ).status,
  ).toBe(409);
  const remove = (actor: string, target = messageId) =>
    runtime.request(actor, `/api/events/${id}/messages/${target}`, 'DELETE');
  expect((await remove('carol')).status).toBe(404);
  const second = await message('bob', id, 'Bringing chips');
  expect((await remove('alice', second.messageId)).status).toBe(200);
  expect((await remove('bob')).status).toBe(200);
  expect(
    (
      (await (
        await runtime.request('carol', `/api/events/${id}/activity`)
      ).json()) as { items: { kind: string }[] }
    ).items.map((item) => item.kind),
  ).toEqual(['response', 'response']);
});

it('notifies hosts of answers and guests of host messages, changes and cancellation', async () => {
  const { id, token } = await event();
  await respond('bob', id, 'going', token);
  await respond('carol', id, 'maybe', token);
  const hostItems = await activity('alice');
  expect(
    hostItems.map((item) => [item.kind, item.handle, item.response]),
  ).toEqual([
    ['event_response', 'carol', 'maybe'],
    ['event_response', 'bob', 'going'],
  ]);
  expect(hostItems[0]).toMatchObject({ eventId: id, eventTitle: 'Dinner' });
  // Older clients that cannot render event activity do not receive it.
  expect(await activity('alice', false)).toEqual([]);
  expect(await unread('alice', false)).toBe(0);
  expect(await unread('alice')).toBe(2);
  const bobKey = hostItems[1].key;
  const version = hostItems[1].version;
  await respond('bob', id, 'going');
  expect(
    (await activity('alice')).find((item) => item.key === bobKey),
  ).toMatchObject({
    version,
  });
  await runtime.request('alice', '/api/notifications/read', 'POST', {
    items: [{ key: bobKey, version }],
  });
  expect(await unread('alice')).toBe(1);
  await respond('bob', id, 'declined');
  const changed = (await activity('alice')).find(
    (item) => item.key === bobKey,
  )!;
  expect(changed).toMatchObject({ response: 'declined', unread: true });
  expect(changed.version).toBeGreaterThan(version);

  // Guest messages reach hosts; host messages reach every guest who answered.
  await message('bob', id, 'Running late');
  expect((await activity('carol')).map((item) => item.kind)).toEqual([]);
  expect((await activity('alice'))[0]).toMatchObject({
    kind: 'event_message',
    messageKind: 'message',
    handle: 'bob',
    body: 'Running late',
  });
  await message('alice', id, 'Doors at 7');
  for (const guest of ['bob', 'carol'])
    expect((await activity(guest))[0]).toMatchObject({
      kind: 'event_message',
      messageKind: 'message',
      body: 'Doors at 7',
    });

  const patch = (
    input: Record<string, unknown>,
    messageId = crypto.randomUUID(),
  ) =>
    runtime.request('alice', `/api/events/${id}`, 'PATCH', {
      ...details(),
      ...input,
      messageId,
    });
  const current = (await (
    await runtime.request('alice', `/api/events/${id}`)
  ).json()) as { event: { startsAt: number } };
  expect(
    (await patch({ startsAt: current.event.startsAt, title: 'Supper' })).status,
  ).toBe(200);
  expect((await activity('bob'))[0]).toMatchObject({ body: 'Doors at 7' });
  expect(
    (
      await runtime.request('bob', `/api/events/${id}`, 'PATCH', {
        ...details(),
        messageId: crypto.randomUUID(),
      })
    ).status,
  ).toBe(409);
  const moved = crypto.randomUUID();
  const input = {
    title: 'Supper',
    startsAt: current.event.startsAt + 3600000,
    location: '2 Main St',
  };
  expect((await patch(input, moved)).status).toBe(200);
  expect((await patch(input, moved)).status).toBe(200);
  expect((await activity('carol'))[0]).toMatchObject({
    messageKind: 'changed',
    body: 'time,location',
    eventTitle: 'Supper',
  });
  expect(
    (await activity('carol')).filter((item) => item.messageKind === 'changed'),
  ).toHaveLength(1);
  await runtime.request('alice', `/api/events/${id}/cancel`, 'POST', {
    messageId: crypto.randomUUID(),
  });
  expect((await activity('bob'))[0]).toMatchObject({
    messageKind: 'cancelled',
  });
  // Someone who stops being a participant stops seeing the event's activity.
  await runtime.db
    .prepare("DELETE FROM event_response WHERE user_id='carol'")
    .run();
  expect(await activity('carol')).toEqual([]);
});

it('lets people join only by signing in through an event link, recording the link', async () => {
  const { id, token } = await event();
  const linkId = (await link(id))!.id;
  const requestEmail = (email: string, eventLink: string = token) =>
    runtime.request(
      null,
      '/api/auth/sign-in/magic-link',
      'POST',
      {
        email,
        callbackURL: `/#event/${id}`,
        errorCallbackURL: '/?error=event',
        metadata: { eventLink },
      },
      { 'CF-Connecting-IP': `192.0.2.${++ip}` },
    );
  const verify = async (message = sent.at(-1)!) => {
    const url = new URL(message.text.match(/https?:\/\/\S+/)![0]);
    return runtime.worker.dispatchFetch(url.toString(), {
      headers: { 'CF-Connecting-IP': `192.0.2.${++ip}` },
      redirect: 'manual',
    });
  };
  const as =
    (cookie: string) =>
    (path: string, init: { method?: string; body?: string } = {}) =>
      runtime.worker.dispatchFetch(`http://localhost:8787${path}`, {
        ...init,
        headers: {
          Cookie: cookie,
          Origin: 'http://localhost:8787',
          'Content-Type': 'application/json',
        },
      });
  // Without an event link, nobody new can request an email.
  expect(
    (
      await runtime.request(null, '/api/auth/sign-in/magic-link', 'POST', {
        email: 'erin@example.com',
        callbackURL: '/',
      })
    ).status,
  ).toBe(403);
  expect((await requestEmail('erin@example.com', 'x'.repeat(48))).status).toBe(
    403,
  );
  expect(sent).toHaveLength(0);
  expect((await requestEmail('erin@example.com')).status).toBe(200);
  const verified = await verify();
  expect(verified.status).toBe(302);
  expect(verified.headers.get('Location')).toBe(
    `http://localhost:8787/#event/${id}`,
  );
  const asErin = as(verified.headers.get('Set-Cookie')!.split(';')[0]);
  expect(
    await runtime.db
      .prepare(
        `SELECT m.invited_by AS inviter,i.kind,i.event_id AS eventId,i.event_link_id AS linkId,
        a.link_id AS opened FROM user u JOIN membership m ON m.user_id=u.id
        JOIN invitation i ON i.id=m.invitation_id JOIN event_access a ON a.user_id=u.id
        WHERE u.email='erin@example.com'`,
      )
      .first(),
  ).toEqual({
    inviter: 'alice',
    kind: 'shared',
    eventId: id,
    linkId,
    opened: linkId,
  });
  // New members give only a name; a unique username is generated.
  expect(await (await asErin('/api/bootstrap')).json()).toMatchObject({
    profile: null,
  });
  const name = (displayName: string, member = asErin) =>
    member('/api/people/self', {
      method: 'PUT',
      body: JSON.stringify({ displayName }),
    });
  expect((await name('Érin Example')).status).toBe(200);
  expect(await (await asErin('/api/bootstrap')).json()).toMatchObject({
    profile: {
      handle: 'erin_example',
      displayName: 'Érin Example',
      bio: '',
      hasAvatar: 0,
    },
  });
  // Changing the name keeps the generated username.
  expect(await (await name('Erin E')).json()).toMatchObject({
    profile: { handle: 'erin_example', displayName: 'Erin E' },
  });
  expect(await (await asErin(`/api/events/${id}`)).json()).toMatchObject({
    event: { counts: null, viewer: { response: null } },
  });
  expect(
    (
      await asErin(`/api/events/${id}/response`, {
        method: 'POST',
        body: JSON.stringify({ status: 'going' }),
      })
    ).status,
  ).toBe(200);
  expect((await asErin('/api/posts')).status).toBe(409);
  expect(
    (await activity('alice')).map((item) => [item.kind, item.displayName]),
  ).toEqual([['event_response', 'Erin E']]);
  expect(
    await runtime.db.prepare('SELECT COUNT(*) AS n FROM follow').first('n'),
  ).toBe(0);

  // The same name gets a different hidden username.
  await requestEmail('erin2@example.com');
  const asErin2 = as((await verify()).headers.get('Set-Cookie')!.split(';')[0]);
  expect((await name('Erin Example', asErin2)).status).toBe(200);
  expect(
    (
      (await (await asErin2('/api/bootstrap')).json()) as {
        profile: { handle: string };
      }
    ).profile.handle,
  ).toMatch(/^erin_example_[a-z0-9]{1,5}$/);

  // Existing members sign in through the link without new provenance.
  const before = await runtime.db
    .prepare("SELECT invitation_id FROM membership WHERE user_id='bob'")
    .first('invitation_id');
  expect((await requestEmail('bob@example.com')).status).toBe(200);
  expect((await verify()).status).toBe(302);
  expect(
    await runtime.db
      .prepare(
        "SELECT a.link_id AS opened,m.invitation_id AS invitation FROM event_access a JOIN membership m ON m.user_id=a.user_id WHERE a.user_id='bob'",
      )
      .first(),
  ).toEqual({ opened: linkId, invitation: before });

  // Replacing the link before verification rejects the pending email.
  await requestEmail('frank@example.com');
  await runtime.request('alice', `/api/events/${id}/link`, 'POST', {
    id: crypto.randomUUID(),
    expectedId: linkId,
  });
  const rejected = await verify();
  expect(rejected.headers.get('Location')).toMatch(/\/\?error=event$/);
  expect(
    await runtime.db
      .prepare(
        "SELECT 1 FROM membership m JOIN user u ON u.id=m.user_id WHERE u.email='frank@example.com'",
      )
      .first(),
  ).toBeNull();
  // The joins through the old version stay attributed to it.
  expect(
    await runtime.db
      .prepare('SELECT COUNT(*) AS n FROM invitation WHERE event_link_id=?')
      .bind(linkId)
      .first('n'),
  ).toBe(2);

  // Closed events send no email to new people; members can still sign in.
  const other = await event();
  await runtime.request('alice', `/api/events/${other.id}/cancel`, 'POST', {
    messageId: crypto.randomUUID(),
  });
  expect(await check(other.token)).toEqual({ id: other.id, open: false });
  expect((await requestEmail('gina@example.com', other.token)).status).toBe(
    403,
  );
  expect((await requestEmail('bob@example.com', other.token)).status).toBe(200);
});

it('removes events, answers and messages with account deletion', async () => {
  const { id, token } = await event();
  await respond('bob', id, 'going', token);
  await message('bob', id, 'Hello');
  expect(await activity('alice')).toHaveLength(2);
  const remove = (actor: string) =>
    runtime.request(actor, '/api/me', 'DELETE', { confirmation: 'DELETE' });
  expect((await remove('bob')).status).toBe(200);
  const db = runtime.db as unknown as D1Database;
  await cleanupAccounts(db);
  expect(await activity('alice')).toEqual([]);
  expect(
    await runtime.db
      .prepare(
        "SELECT (SELECT COUNT(*) FROM event_response WHERE user_id='bob') AS answers,(SELECT COUNT(*) FROM event_access WHERE user_id='bob') AS opened,(SELECT COUNT(*) FROM event_message WHERE user_id='bob' AND deleted_at IS NULL) AS messages",
      )
      .first(),
  ).toEqual({ answers: 0, opened: 0, messages: 0 });
  await respond('carol', id, 'going', token);
  expect((await remove('alice')).status).toBe(200);
  expect((await runtime.request('carol', `/api/events/${id}`)).status).toBe(
    404,
  );
  await cleanupAccounts(db);
  expect(
    await runtime.db
      .prepare(
        'SELECT state,title,object_key AS key,link_encrypted AS link FROM event WHERE id=?',
      )
      .bind(id)
      .first(),
  ).toEqual({
    state: 'deleted',
    title: 'Deleted event',
    key: null,
    link: null,
  });
  expect(
    await runtime.db
      .prepare(
        "SELECT COUNT(*) AS n FROM photo_cleanup WHERE object_key LIKE 'events/%'",
      )
      .first('n'),
  ).toBe(2);
  // Abandoned drafts expire after a day.
  const stale = await draft('carol');
  await runtime.db
    .prepare('UPDATE event SET created_at=? WHERE id=?')
    .bind(Date.now() - 2 * day, stale.id)
    .run();
  await cleanupEvents(
    db,
    (await runtime.worker.getR2Bucket('PHOTOS')) as unknown as R2Bucket,
  );
  expect(
    await runtime.db
      .prepare('SELECT state FROM event WHERE id=?')
      .bind(stale.id)
      .first('state'),
  ).toBe('deleted');
});

it('processes cover photos for hosts and replaces them retry-safely', async () => {
  const images = await testRuntime(false, true);
  try {
    for (const id of ['alice', 'bob'])
      await images.request(id, '/api/people/self', 'PUT', {
        handle: id,
        displayName: id,
        bio: '',
      });
    await seedProfilePhotos(images.db);
    const id = crypto.randomUUID();
    expect(
      (
        await images.request('alice', '/api/events', 'POST', {
          id,
          ...details(),
        })
      ).status,
    ).toBe(200);
    const bytes = readFileSync('tests/fixtures/photos/oriented.jpg');
    const upload = (actor: string, key: string) =>
      images.request(
        actor,
        `/api/events/${id}/photo`,
        'PUT',
        new Blob([bytes], { type: 'image/jpeg' }),
        { 'Idempotency-Key': key, 'Content-Type': 'image/jpeg' },
      );
    const key = crypto.randomUUID();
    expect((await upload('bob', key)).status).toBe(404);
    expect((await upload('alice', key)).status).toBe(200);
    expect((await upload('alice', key)).status).toBe(200);
    const first = await images.db
      .prepare('SELECT state,object_key AS key,width FROM event WHERE id=?')
      .bind(id)
      .first<{ state: string; key: string; width: number }>();
    expect(first).toMatchObject({ state: 'published' });
    expect(first!.width).toBeGreaterThan(0);
    expect((await upload('alice', crypto.randomUUID())).status).toBe(200);
    expect(
      await images.db
        .prepare('SELECT 1 FROM photo_cleanup WHERE object_key=?')
        .bind(first!.key)
        .first(),
    ).not.toBeNull();
    expect((await images.request('alice', `/media/events/${id}`)).status).toBe(
      200,
    );
  } finally {
    await images.worker.dispose();
  }
});

it('keeps activity, receipts and queued alerts through migration 0030', async () => {
  const old = await testRuntime(false, false, undefined, undefined, 29);
  try {
    for (const id of ['alice', 'bob', 'carol'])
      await old.request(id, '/api/people/self', 'PUT', {
        handle: id,
        displayName: id,
        bio: '',
      });
    await seedProfilePhotos(old.db);
    await old.db.batch([
      old.db.prepare('DELETE FROM follow'),
      old.db.prepare(
        "INSERT INTO push_subscription VALUES('device','alice','alice','https://fcm.googleapis.com/synthetic','key','auth',1)",
      ),
      old.db.prepare("INSERT INTO follow VALUES('bob','alice','pending',900)"),
      old.db.prepare(
        "INSERT INTO post(id,user_id,caption,alt_text,created_at,published_at,state,object_key,width,height) VALUES('p','alice','','',1,1,'published','posts/p',1,1)",
      ),
      old.db.prepare("INSERT INTO post_like VALUES('p','carol',1000)"),
      old.db.prepare(
        "INSERT INTO comment(id,post_id,user_id,body,created_at) VALUES('c','p','bob','Hi',1100)",
      ),
    ]);
    await old.db
      .prepare(
        "UPDATE activity_read_state SET is_read=1 WHERE event_key='likes:p'",
      )
      .run();
    const snapshot = async () =>
      Promise.all(
        ['activity_source', 'activity_read_state', 'push_delivery'].map(
          async (table) =>
            (
              await old.db
                .prepare(`SELECT * FROM ${table} ORDER BY 1,2,3`)
                .all()
            ).results,
        ),
      );
    const before = await snapshot();
    expect(before[2]).toHaveLength(2);
    await old.db.batch(
      unstable_splitSqlQuery(
        readFileSync('migrations/0030_events.sql', 'utf8'),
      ).map((query) => old.db.prepare(query)),
    );
    const after = await snapshot();
    expect(after).toEqual(before);
    // Recreated triggers still produce activity and alerts.
    await old.db.prepare("INSERT INTO post_like VALUES('p','bob',1200)").run();
    await old.db
      .prepare(
        "INSERT INTO comment(id,post_id,user_id,body,created_at) VALUES('c2','p','carol','Hey',1300)",
      )
      .run();
    expect(
      (
        await old.db
          .prepare('SELECT event_key FROM push_delivery ORDER BY event_key')
          .all<{ event_key: string }>()
      ).results.map((row) => row.event_key),
    ).toEqual(['comment:c', 'comment:c2', 'request:bob']);
    expect(
      (await old.db.prepare('PRAGMA foreign_key_check').all()).results,
    ).toEqual([]);
  } finally {
    await old.worker.dispose();
  }
});
