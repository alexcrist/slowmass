import { afterEach, beforeEach, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { unstable_splitSqlQuery } from 'wrangler';
import { testRuntime, seedProfilePhotos } from './support/runtime';
import { cleanupAccounts } from '../src/server/features/account';
import { cleanupEvents, deleteEvent } from '../src/server/features/events';
import { invitationTokenHash } from '../src/server/membership';
import {
  fontPairings,
  originalAppearance,
  type EventAppearance,
} from '../src/shared/event-appearance';

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
    event: { url: string | null };
  };
  if (!event.url) return null;
  return { url: event.url, token: new URL(event.url).pathname.split('/')[2] };
}
async function linkVersion(id: string) {
  return runtime.db
    .prepare('SELECT link_id FROM event WHERE id=?')
    .bind(id)
    .first<string>('link_id');
}
// Only restore quarantine gives an event a new link version; simulate one with
// a working credential but, as after quarantine, no recoverable URL.
async function newLinkVersion(id: string) {
  const token = crypto.randomUUID().replaceAll('-', '').padEnd(48, 'q');
  const version = crypto.randomUUID();
  await runtime.db
    .prepare(
      'UPDATE event SET link_id=?,link_hash=?,link_encrypted=NULL WHERE id=?',
    )
    .bind(version, await invitationTokenHash(token), id)
    .run();
  return { version, token };
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

it('saves appearance separately, exposes only curated IDs in previews, and rejects stale co-host edits', async () => {
  const { id, token } = await event();
  const appearance = {
    colorTheme: 'wine',
    fontPairing: 'classic',
  } satisfies EventAppearance;
  const other = {
    colorTheme: 'pool',
    fontPairing: 'bungee-shade',
  } satisfies EventAppearance;
  const save = (next: EventAppearance, expected = originalAppearance) =>
    runtime.request('alice', `/api/events/${id}/appearance`, 'PATCH', {
      appearance: next,
      expected,
    });
  await respond('bob', id, 'going', token);
  const before = await Promise.all(
    ['activity_source', 'push_delivery', 'event_message'].map(
      async (table) =>
        (await runtime.db.prepare(`SELECT * FROM ${table} ORDER BY 1,2`).all())
          .results,
    ),
  );
  const results = await Promise.all([save(appearance), save(other)]);
  expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  const winner = results[0].status === 200 ? appearance : other;
  expect((await save(winner)).status).toBe(200);
  // A details edit by an older client must preserve the new appearance.
  expect(
    (
      await runtime.request(
        'alice',
        `/api/events/${id}`,
        'PATCH',
        details({ title: 'Updated dinner' }),
      )
    ).status,
  ).toBe(200);
  expect(
    await (await runtime.request('bob', `/api/events/${id}`)).json(),
  ).toMatchObject({ event: { title: 'Updated dinner', appearance: winner } });
  expect(await check(token)).toEqual({
    id,
    open: true,
    preview: {
      title: 'Updated dinner',
      date: expect.any(String),
      width: 4,
      height: 3,
      appearance: winner,
    },
  });
  expect(
    await Promise.all(
      ['activity_source', 'push_delivery', 'event_message'].map(
        async (table) =>
          (
            await runtime.db
              .prepare(`SELECT * FROM ${table} ORDER BY 1,2`)
              .all()
          ).results,
      ),
    ),
  ).toEqual(before);
  // A later edit cannot be rolled back by retrying the first operation.
  expect((await save(originalAppearance, winner)).status).toBe(200);
  expect((await save(other, winner)).status).toBe(409);
});

it('persists every current font on creation, in event reads and signed-out previews', async () => {
  for (const fontPairing of fontPairings) {
    const appearance = { colorTheme: 'pool', fontPairing };
    const input = { id: crypto.randomUUID(), ...details(), appearance };
    const create = () => runtime.request('alice', '/api/events', 'POST', input);
    expect((await create()).status).toBe(200);
    expect((await create()).status).toBe(200);
    await publish(input.id);
    expect(
      await (await runtime.request('alice', `/api/events/${input.id}`)).json(),
    ).toMatchObject({ event: { appearance } });
    const credential = await link(input.id);
    expect(await check(credential!.token)).toMatchObject({
      preview: { appearance },
    });
  }
});

it('resolves retired saved fonts consistently for reads, previews and conditional saves', async () => {
  const { id, token } = await event();
  for (const [legacy, current] of [
    ['original', 'original'],
    ['handwritten', 'handwritten'],
    ['classic', 'classic'],
    ['poster', 'bungee-shade'],
    ['rounded', 'fascinate-inline'],
    ['geometric', 'monoton'],
  ]) {
    // Replays an appearance write by the previous Worker, including after a
    // new-Worker save. Its trigger must let the legacy selection take effect.
    await runtime.db
      .prepare("UPDATE event SET color_theme='wine',font_pairing=? WHERE id=?")
      .bind(legacy, id)
      .run();
    const expected = { colorTheme: 'wine', fontPairing: current };
    expect(
      await (await runtime.request('alice', `/api/events/${id}`)).json(),
    ).toMatchObject({ event: { appearance: expected } });
    expect(await check(token)).toMatchObject({
      preview: { appearance: expected },
    });
    const appearance = { colorTheme: 'wine', fontPairing: 'rubik-wet-paint' };
    const save = () =>
      runtime.request('alice', `/api/events/${id}/appearance`, 'PATCH', {
        appearance,
        expected,
      });
    expect((await save()).status).toBe(200);
    expect((await save()).status).toBe(200);
    expect(await check(token)).toMatchObject({ preview: { appearance } });
    expect(
      (
        await runtime.request(
          'alice',
          `/api/events/${id}/appearance`,
          'PATCH',
          {
            appearance: { colorTheme: 'pool', fontPairing: 'monoton' },
            expected,
          },
        )
      ).status,
    ).toBe(409);
  }
});

it('allows only current unblocked hosts to change appearance, including accepted co-hosts', async () => {
  const { id, token } = await event();
  const appearance = {
    colorTheme: 'evergreen',
    fontPairing: 'fascinate-inline',
  } satisfies EventAppearance;
  const save = (actor: string | null) =>
    runtime.request(actor, `/api/events/${id}/appearance`, 'PATCH', {
      appearance,
      expected: originalAppearance,
    });
  expect((await save(null)).status).toBe(401);
  expect((await save('carol')).status).toBe(409);
  await open('bob', token);
  expect((await save('bob')).status).toBe(409);
  await respond('bob', id, 'going');
  expect((await save('bob')).status).toBe(409);
  await runtime.request('alice', `/api/events/${id}/hosts`, 'POST', {
    email: 'bob@example.com',
  });
  expect((await save('bob')).status).toBe(409);
  expect(
    (await runtime.request('bob', `/api/events/${id}/hosting`, 'POST')).status,
  ).toBe(200);
  expect((await save('bob')).status).toBe(200);
  await runtime.db.prepare("INSERT INTO block VALUES('alice','bob',1)").run();
  expect((await save('bob')).status).toBe(409);
  await runtime.db.prepare('DELETE FROM block').run();
  await runtime.request('alice', `/api/events/${id}/hosts/bob`, 'DELETE');
  expect((await save('bob')).status).toBe(409);
  await runtime.db
    .prepare("UPDATE membership SET status='disabled' WHERE user_id='alice'")
    .run();
  expect((await save('alice')).status).toBe(401);
  await runtime.db
    .prepare("UPDATE membership SET status='active' WHERE user_id='alice'")
    .run();
  await runtime.db
    .prepare('UPDATE event SET cancelled_at=1 WHERE id=?')
    .bind(id)
    .run();
  expect((await save('alice')).status).toBe(409);
  await runtime.db
    .prepare("UPDATE event SET state='deleted',cancelled_at=NULL WHERE id=?")
    .bind(id)
    .run();
  expect((await save('alice')).status).toBe(409);
});

it('validates appearance at both HTTP and storage boundaries and denies expired sessions', async () => {
  const { id } = await event();
  for (const appearance of [
    null,
    [],
    {},
    { colorTheme: '#fff', fontPairing: 'original' },
    { colorTheme: 'wine', fontPairing: 'https://example.com/font' },
    ...['poster', 'rounded', 'geometric'].map((fontPairing) => ({
      colorTheme: 'wine',
      fontPairing,
    })),
  ])
    expect(
      (
        await runtime.request(
          'alice',
          `/api/events/${id}/appearance`,
          'PATCH',
          { appearance, expected: originalAppearance },
        )
      ).status,
    ).toBe(400);
  expect(
    (
      await runtime.request('alice', `/api/events/${id}/appearance`, 'PATCH', {
        appearance: originalAppearance,
      })
    ).status,
  ).toBe(400);
  for (const column of ['color_theme', 'font_pairing', 'font_pairing_v2'])
    await expect(
      runtime.db
        .prepare(`UPDATE event SET ${column}='unknown' WHERE id=?`)
        .bind(id)
        .run(),
    ).rejects.toThrow();
  await runtime.db
    .prepare("UPDATE session SET expiresAt=? WHERE userId='alice'")
    .bind(new Date(0).toISOString())
    .run();
  expect(
    (
      await runtime.request('alice', `/api/events/${id}/appearance`, 'PATCH', {
        appearance: originalAppearance,
        expected: originalAppearance,
      })
    ).status,
  ).toBe(401);
});

it('creates appearance atomically and rejects conflicting or invalid creation retries', async () => {
  const id = crypto.randomUUID();
  const appearance = { colorTheme: 'wine', fontPairing: 'classic' };
  const input = { id, ...details(), appearance };
  const create = (body = input) =>
    runtime.request('alice', '/api/events', 'POST', body);
  const attempts = await Promise.all([create(), create()]);
  expect(attempts.map((response) => response.status)).toEqual([200, 200]);
  expect(
    await runtime.db
      .prepare(
        'SELECT state,color_theme,font_pairing_v2 AS font_pairing FROM event WHERE id=?',
      )
      .bind(id)
      .first(),
  ).toEqual({ state: 'pending', color_theme: 'wine', font_pairing: 'classic' });
  expect(
    await runtime.db
      .prepare('SELECT COUNT(*) AS count FROM event_host WHERE event_id=?')
      .bind(id)
      .first('count'),
  ).toBe(1);
  expect(
    (await create({ ...input, appearance: originalAppearance })).status,
  ).toBe(409);
  for (const invalid of [
    null,
    {},
    { colorTheme: 'unknown', fontPairing: 'classic' },
    { colorTheme: 'wine', fontPairing: 'url(https://example.com/font)' },
  ]) {
    const invalidId = crypto.randomUUID();
    expect(
      (
        await runtime.request('alice', '/api/events', 'POST', {
          ...input,
          id: invalidId,
          appearance: invalid,
        })
      ).status,
    ).toBe(400);
    expect(
      await runtime.db
        .prepare('SELECT id FROM event WHERE id=?')
        .bind(invalidId)
        .first(),
    ).toBeNull();
  }
  await publish(id);
  expect(await (await create()).json()).toEqual({ id, state: 'published' });
  expect(
    await (await runtime.request('alice', `/api/events/${id}`)).json(),
  ).toMatchObject({ event: { appearance } });
  const eventLink = (await link(id))!;
  expect(await check(eventLink.token)).toMatchObject({
    preview: { appearance },
  });
});

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
      appearance: originalAppearance,
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

it('unfurls only the event title and processed cover without a session or side effects', async () => {
  const title = 'Dinner & "friends" <script>alert(1)</script>';
  const input = details({ title });
  const { id, token, url } = await event(input);
  const bucket = await runtime.worker.getR2Bucket('PHOTOS');
  await bucket.put(`events/${id}-thumb.webp`, 'processed thumbnail');
  await bucket.put(`events/${id}.webp`, 'full cover');
  const counts = async () =>
    Promise.all(
      ['event_access', 'event_response', 'membership', 'invitation'].map(
        async (table) =>
          runtime.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first('n'),
      ),
    );
  const before = await counts();
  // A crawler supplies no cookies, Origin header, or JavaScript execution.
  const response = await runtime.worker.dispatchFetch(url);
  expect(response.status).toBe(200);
  expect(response.headers.get('Content-Type')).toContain('text/html');
  expect(response.headers.get('Cache-Control')).toContain('no-store');
  expect(response.headers.get('Cache-Control')).toContain('no-transform');
  expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
  expect(response.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
  expect(response.headers.has('ETag')).toBe(false);
  expect(response.headers.has('Set-Cookie')).toBe(false);
  const html = await response.text();
  expect(html).toContain(
    'property="og:title" content="Dinner &amp; &quot;friends&quot; &lt;script&gt;alert(1)&lt;/script&gt;"',
  );
  expect(html).toContain(`property="og:url" content="${url}"`);
  expect(html).toContain(`property="og:image" content="${url}/photo"`);
  expect(html).toContain('name="twitter:card" content="summary_large_image"');
  expect(html).toContain('id="root"');
  for (const privateValue of [
    input.description,
    input.location,
    String(input.startsAt),
    input.timeZone,
    'Alice',
    'alice@example.com',
    id,
    '<script>alert(1)</script>',
    'og:description',
    'name="description"',
  ])
    expect(html).not.toContain(privateValue);
  const photo = await runtime.worker.dispatchFetch(`${url}/photo`);
  expect(photo.status).toBe(200);
  expect(photo.headers.get('Content-Type')).toBe('image/webp');
  expect(photo.headers.get('Cache-Control')).toContain('no-store');
  expect(await photo.text()).toBe('processed thumbnail');
  const head = await runtime.worker.dispatchFetch(url, { method: 'HEAD' });
  expect(head.status).toBe(200);
  expect(await head.text()).toBe('');
  expect(await counts()).toEqual(before);
  expect((await runtime.request(null, `/api/events/${id}`)).status).toBe(401);
  expect((await runtime.request(null, `/media/events/${id}`)).status).toBe(404);
  expect(
    (await runtime.request(null, `/event/${token}/calendar.ics`)).status,
  ).toBe(404);
});

it('rechecks event share availability and blocks, including warm cover bytes', async () => {
  const { id, token } = await event();
  const bucket = await runtime.worker.getR2Bucket('PHOTOS');
  await bucket.put(`events/${id}-thumb.webp`, 'thumbnail');
  const statuses = async (credential = token, actor: string | null = null) =>
    Promise.all(
      ['', '/photo'].map(async (suffix) => {
        const response = await runtime.request(
          actor,
          `/event/${credential}${suffix}`,
        );
        await response.arrayBuffer();
        return response.status;
      }),
    );
  expect(await statuses()).toEqual([200, 200]);
  expect(await statuses('bad')).toEqual([404, 404]);
  expect(await statuses('z'.repeat(48))).toEqual([404, 404]);
  expect(await statuses(id)).toEqual([404, 404]);
  await runtime.db
    .prepare(
      "INSERT INTO block(blocker_id,target_id,created_at) VALUES ('alice','bob',?)",
    )
    .bind(Date.now())
    .run();
  expect(await statuses(token, 'bob')).toEqual([404, 404]);
  // Public previews still work signed out; blocking is not a privacy promise.
  expect(await statuses()).toEqual([200, 200]);
  for (const state of ['pending', 'deleted']) {
    await runtime.db
      .prepare('UPDATE event SET state=? WHERE id=?')
      .bind(state, id)
      .run();
    expect(await statuses()).toEqual([404, 404]);
  }
  await publish(id);
  await runtime.db
    .prepare("UPDATE membership SET status='deleted' WHERE user_id='alice'")
    .run();
  expect(await statuses()).toEqual([404, 404]);
  await runtime.db
    .prepare("UPDATE membership SET status='active' WHERE user_id='alice'")
    .run();
  expect(await statuses()).toEqual([200, 200]);
  await newLinkVersion(id);
  expect(await statuses()).toEqual([404, 404]);
});

it('retains title/cover previews for closed events but denies them after creator deletion', async () => {
  const { id, token } = await event();
  const bucket = await runtime.worker.getR2Bucket('PHOTOS');
  await bucket.put(`events/${id}-thumb.webp`, 'thumbnail');
  await runtime.db
    .prepare('UPDATE event SET starts_at=?,cancelled_at=? WHERE id=?')
    .bind(Date.now() - 2 * day, Date.now(), id)
    .run();
  expect((await check(token))?.open).toBe(false);
  for (const suffix of ['', '/photo']) {
    const response = await runtime.request(null, `/event/${token}${suffix}`);
    expect(response.status).toBe(200);
    await response.arrayBuffer();
  }
  expect(
    (await runtime.request('alice', `/api/events/${id}`, 'DELETE')).status,
  ).toBe(200);
  for (const suffix of ['', '/photo'])
    expect(
      (await runtime.request(null, `/event/${token}${suffix}`)).status,
    ).toBe(404);
});

it('keeps share previews closed during maintenance', async () => {
  await runtime.worker.dispose();
  runtime = await testRuntime(true);
  for (const suffix of ['', '/photo'])
    expect(
      (await runtime.request(null, `/event/${'a'.repeat(48)}${suffix}`)).status,
    ).toBe(503);
});

it('previews a linked event, shows details after sign-in, and guests after answering', async () => {
  const { id, token, url } = await event();
  expect(new URL(url).pathname).toBe(`/event/${token}`);
  expect(new URL(url).search).toBe('');
  expect(new URL(url).hash).toBe('');
  // Signed out, expose only the preview (not times, location or people).
  expect(await check(token)).toEqual({
    id,
    open: true,
    preview: {
      appearance: { colorTheme: 'original', fontPairing: 'original' },
      title: 'Dinner',
      date: expect.any(String),
      width: 4,
      height: 3,
    },
  });
  expect(await check('x'.repeat(48))).toBeNull();
  expect(await link(id, 'bob')).toBeNull();
  expect((await runtime.request('bob', `/api/events/${id}`)).status).toBe(404);
  expect((await open('bob', 'x'.repeat(48))).status).toBe(404);
  expect(await (await open('bob', token)).json()).toEqual({ id });
  const opened = await runtime.db
    .prepare("SELECT link_id FROM event_access WHERE user_id='bob'")
    .first('link_id');
  expect(opened).toBe(await linkVersion(id));
  // Opening shows details and the URL, but not who answered.
  expect(
    await (await runtime.request('bob', `/api/events/${id}`)).json(),
  ).toMatchObject({
    event: {
      id,
      title: 'Dinner',
      counts: null,
      url,
      pendingHosts: [],
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

  // A new link version cuts off people who only opened the old one, not those
  // who answered.
  await respond('carol', id, 'going', token);
  const fresh = await newLinkVersion(id);
  expect(await check(token)).toBeNull();
  expect((await runtime.request('bob', `/api/events/${id}`)).status).toBe(404);
  expect((await media('bob')).status).toBe(404);
  expect((await open('bob', token)).status).toBe(404);
  expect(
    await (await runtime.request('carol', `/api/events/${id}`)).json(),
  ).toMatchObject({ event: { id, url: null } });
  expect(await (await open('bob', fresh.token)).json()).toEqual({ id });
  expect(
    await runtime.db
      .prepare("SELECT link_id FROM event_access WHERE user_id='bob'")
      .first('link_id'),
  ).toBe(fresh.version);
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

it('lets hosts answer and add co-hosts by email without revealing accounts', async () => {
  const { id, token } = await event();
  const view = async (actor: string) =>
    (
      (await (await runtime.request(actor, `/api/events/${id}`)).json()) as {
        event: {
          hosts: { handle: string; isCreator: boolean; isViewer: boolean }[];
          pendingHosts: string[];
          viewer: {
            isHost: boolean;
            hostInvited: boolean;
            response: string | null;
          };
        };
      }
    ).event;
  const add = (actor: string, email: unknown) =>
    runtime.request(actor, `/api/events/${id}/hosts`, 'POST', { email });
  const unpend = (actor: string, email: string) =>
    runtime.request(actor, `/api/events/${id}/hosts`, 'DELETE', { email });
  const remove = (actor: string, handle: string) =>
    runtime.request(actor, `/api/events/${id}/hosts/${handle}`, 'DELETE');
  const accept = (actor: string) =>
    runtime.request(actor, `/api/events/${id}/hosting`, 'POST');

  // Hosts answer without opening the link and appear among the guests.
  expect((await respond('alice', id, 'going')).status).toBe(200);
  expect(await view('alice')).toMatchObject({
    viewer: { isHost: true, response: 'going' },
  });
  expect(
    await (
      await runtime.request('alice', `/api/events/${id}/guests?status=going`)
    ).json(),
  ).toEqual({
    items: [{ handle: 'alice', displayName: 'Alice', hasAvatar: true }],
    next: null,
  });

  // Adding replies the same whether or not an account uses the email.
  expect((await add('alice', 'not an email')).status).toBe(400);
  expect((await add('alice', ' Bob@Example.com ')).status).toBe(200);
  expect((await add('alice', 'bob@example.com')).status).toBe(200);
  expect((await add('alice', 'nobody@example.com')).status).toBe(200);
  expect((await add('alice', 'david@example.com')).status).toBe(200);
  expect((await view('alice')).pendingHosts).toEqual([
    'bob@example.com',
    'nobody@example.com',
    'david@example.com',
  ]);
  // Only hosts add hosts or see pending ones; an email alone grants nothing.
  expect((await respond('carol', id, 'maybe', token)).status).toBe(200);
  expect((await add('carol', 'erin@example.com')).status).toBe(409);
  expect((await view('carol')).pendingHosts).toEqual([]);
  expect((await runtime.request('bob', `/api/events/${id}`)).status).toBe(404);

  // Opening the event signed in with that email offers hosting; accepting is
  // their consent to appear as a host.
  expect((await accept('carol')).status).toBe(409);
  await open('bob', token);
  expect(await view('bob')).toMatchObject({
    viewer: { isHost: false, hostInvited: true },
    hosts: [{ handle: 'alice' }],
  });
  for (let attempt = 0; attempt < 2; attempt++)
    expect((await accept('bob')).status).toBe(200);
  expect(await view('bob')).toMatchObject({
    viewer: { isHost: true, hostInvited: false },
    hosts: [
      { handle: 'alice', isCreator: true, isViewer: false },
      { handle: 'bob', isCreator: false, isViewer: true },
    ],
    pendingHosts: ['nobody@example.com', 'david@example.com'],
  });
  // Co-hosts hear about answers like the creator does.
  expect((await respond('carol', id, 'going')).status).toBe(200);
  for (const host of ['alice', 'bob'])
    expect(
      (await activity(host)).find((item) => item.handle === 'carol'),
    ).toMatchObject({ kind: 'event_response', response: 'going' });
  // Without a profile photo, the invitation waits.
  await open('david', token);
  expect((await view('david')).viewer.hostInvited).toBe(false);
  expect((await accept('david')).status).toBe(409);
  expect((await view('alice')).pendingHosts).toContain('david@example.com');
  // Declining removes the invitation.
  await add('alice', 'carol@example.com');
  expect((await view('carol')).viewer.hostInvited).toBe(true);
  expect(
    (await runtime.request('carol', `/api/events/${id}/hosting`, 'DELETE'))
      .status,
  ).toBe(200);
  expect((await view('carol')).viewer.hostInvited).toBe(false);
  expect((await view('alice')).pendingHosts).not.toContain('carol@example.com');

  // Any host removes pending emails and co-hosts, never the creator.
  expect((await unpend('carol', 'nobody@example.com')).status).toBe(404);
  for (let attempt = 0; attempt < 2; attempt++)
    expect((await unpend('bob', 'nobody@example.com')).status).toBe(200);
  expect((await remove('bob', 'alice')).status).toBe(409);
  expect((await remove('carol', 'bob')).status).toBe(409);
  for (let attempt = 0; attempt < 2; attempt++)
    expect((await remove('alice', 'bob')).status).toBe(200);
  // Bob opened the link, so he still sees the event as a guest.
  expect((await view('bob')).viewer.isHost).toBe(false);
  expect((await add('bob', 'carol@example.com')).status).toBe(409);
  // Co-hosts can stop hosting themselves; retrying succeeds.
  await add('alice', 'bob@example.com');
  await accept('bob');
  expect((await view('bob')).viewer.isHost).toBe(true);
  for (let attempt = 0; attempt < 2; attempt++)
    expect((await remove('bob', 'bob')).status).toBe(200);
  expect((await view('bob')).viewer.isHost).toBe(false);

  // Hosts and pending emails together stay within ten.
  for (let index = 0; index < 8; index++)
    expect((await add('alice', `friend${index}@example.com`)).status).toBe(200);
  expect((await add('alice', 'one-more@example.com')).status).toBe(409);
  // Deleting an account drops pending invitations to its email.
  expect(
    (
      await runtime.request('david', '/api/me', 'DELETE', {
        confirmation: 'DELETE',
      })
    ).status,
  ).toBe(200);
  expect((await view('alice')).pendingHosts).not.toContain('david@example.com');
  // Pending emails go once the event ends.
  await runtime.request('alice', `/api/events/${id}/cancel`, 'POST', {
    messageId: crypto.randomUUID(),
  });
  expect((await add('alice', 'late@example.com')).status).toBe(409);
  await cleanupEvents(
    runtime.db as unknown as D1Database,
    (await runtime.worker.getR2Bucket('PHOTOS')) as unknown as R2Bucket,
  );
  expect(
    await runtime.db
      .prepare('SELECT COUNT(*) AS n FROM event_host_invite')
      .first('n'),
  ).toBe(0);
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

it('keeps events unlisted until a member opens their link, even for followers and pending hosts', async () => {
  const future = await event(details({ title: 'Unlisted future event' }));
  const past = await event(
    details({ title: 'Unlisted past event', startsAt: Date.now() - day }),
  );
  await runtime.db
    .prepare(
      "INSERT INTO follow(follower_id,target_id,status,created_at) VALUES ('bob','alice','accepted',?)",
    )
    .bind(Date.now())
    .run();
  expect(
    (
      await runtime.request('alice', `/api/events/${future.id}/hosts`, 'POST', {
        email: 'bob@example.com',
      })
    ).status,
  ).toBe(200);
  await message('alice', future.id, 'Private host message');
  for (const actor of ['bob', 'carol', 'david']) {
    for (const when of ['upcoming', 'past']) {
      expect(
        await (await runtime.request(actor, `/api/events?when=${when}`)).json(),
      ).toEqual({ items: [], next: null });
    }
    expect((await activity(actor)).filter((item) => item.eventId)).toEqual([]);
    for (const { id } of [future, past]) {
      for (const path of [
        `/api/events/${id}`,
        `/api/events/${id}/calendar.ics`,
        `/media/events/${id}`,
        `/media/events/${id}?size=thumb`,
      ])
        expect((await runtime.request(actor, path)).status).toBe(404);
      for (const path of [
        `/api/events/${id}/guests?status=going`,
        `/api/events/${id}/activity`,
      ]) {
        const response = await runtime.request(actor, path);
        expect(await response.json()).toEqual({ items: [], next: null });
      }
    }
  }
  expect(
    (await runtime.request('bob', `/api/events/${future.id}/hosting`, 'POST'))
      .status,
  ).toBe(409);
  expect((await respond('carol', future.id, 'going')).status).toBe(409);
  // Previews don't silently add an event to a signed-in member's account.
  await (await runtime.request('bob', `/event/${future.token}`)).text();
  expect(await (await runtime.request('bob', '/api/events')).json()).toEqual({
    items: [],
    next: null,
  });
  expect((await open('bob', future.token)).status).toBe(200);
  expect(
    await (await runtime.request('bob', '/api/events')).json(),
  ).toMatchObject({ items: [{ id: future.id }], next: null });
  expect(
    (await runtime.request('bob', `/api/events/${future.id}`)).status,
  ).toBe(200);
  expect((await runtime.request('bob', `/api/events/${past.id}`)).status).toBe(
    404,
  );
  expect(await (await runtime.request('carol', '/api/events')).json()).toEqual({
    items: [],
    next: null,
  });
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

it('notifies hosts of answers and guests of host messages and cancellation, with silent edits', async () => {
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
    messageKind: 'message',
    body: 'Doors at 7',
    eventTitle: 'Supper',
  });
  expect(
    (await activity('carol')).filter((item) => item.messageKind === 'changed'),
  ).toHaveLength(0);
  expect(
    await runtime.db
      .prepare("SELECT COUNT(*) AS n FROM event_message WHERE kind='changed'")
      .first('n'),
  ).toBe(0);
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

it('hides historical detail changes from the log, Activity, badge, focus and read receipts', async () => {
  const { id, token } = await event();
  await respond('bob', id, 'going', token);
  const messageId = crypto.randomUUID();
  await runtime.db
    .prepare(
      "INSERT INTO event_message(id,event_id,user_id,kind,body,created_at) VALUES(?,?,'alice','changed','time,location',?)",
    )
    .bind(messageId, id, Date.now())
    .run();
  const key = `event_message:${messageId}`;
  const version = await runtime.db
    .prepare(
      "SELECT revision FROM activity_read_state WHERE recipient_id='bob' AND event_key=?",
    )
    .bind(key)
    .first<number>('revision');
  expect(await activity('bob')).toEqual([]);
  expect(await unread('bob')).toBe(0);
  expect(
    await (
      await runtime.request(
        'bob',
        `/api/notifications?includeEvents=1&focus=${key}`,
      )
    ).json(),
  ).toMatchObject({ focusFound: false, items: [] });
  const log = (await (
    await runtime.request('bob', `/api/events/${id}/activity`)
  ).json()) as { items: { kind: string }[] };
  expect(log.items.map((item) => item.kind)).toEqual(['response']);
  await runtime.request('bob', '/api/notifications/read', 'POST', {
    items: [{ key, version }],
  });
  expect(
    await runtime.db
      .prepare(
        "SELECT is_read FROM activity_read_state WHERE recipient_id='bob' AND event_key=?",
      )
      .bind(key)
      .first('is_read'),
  ).toBe(0);
});

it('sends retry-safe host notifications to all participants without email, enforcing host access', async () => {
  const { id, token } = await event();
  await respond('bob', id, 'declined', token);
  await respond('david', id, 'maybe', token);
  await open('carol', token);
  const path = `/api/events/${id}/notifications`;
  const input = { id: crypto.randomUUID(), body: '  Bring a jacket  ' };
  // Answered guests, link viewers, pending hosts and signed-out users cannot blast.
  for (const actor of ['bob', 'carol', 'david'])
    expect((await runtime.request(actor, path, 'POST', input)).status).toBe(
      409,
    );
  expect((await runtime.request(null, path, 'POST', input)).status).toBe(401);
  await runtime.request('alice', `/api/events/${id}/hosts`, 'POST', {
    email: 'carol@example.com',
  });
  expect((await runtime.request('carol', path, 'POST', input)).status).toBe(
    409,
  );
  for (const body of ['', 'x'.repeat(2001)])
    expect(
      (await runtime.request('alice', path, 'POST', { ...input, body })).status,
    ).toBe(400);
  const results = await Promise.all([
    runtime.request('alice', path, 'POST', input),
    runtime.request('alice', path, 'POST', input),
  ]);
  expect(results.map((result) => result.status)).toEqual([200, 200]);
  for (const actor of ['bob', 'david']) {
    expect(await activity(actor)).toEqual([
      expect.objectContaining({
        body: 'Bring a jacket',
        unread: true,
        key: `event_message:${input.id}`,
      }),
    ]);
    expect(await unread(actor)).toBe(1);
  }
  expect(await activity('carol')).toEqual([]);
  expect(
    (
      await runtime.request('alice', path, 'POST', {
        ...input,
        body: 'Different message',
      })
    ).status,
  ).toBe(409);
  expect(
    (await runtime.request('carol', `/api/events/${id}/hosting`, 'POST'))
      .status,
  ).toBe(200);
  const cohostInput = { id: crypto.randomUUID(), body: 'Doors are open' };
  expect(
    (await runtime.request('carol', path, 'POST', cohostInput)).status,
  ).toBe(200);
  expect((await activity('alice'))[0]).toMatchObject({
    body: 'Doors are open',
  });
  await runtime.request('alice', `/api/events/${id}/hosts/carol`, 'DELETE');
  expect(
    (await runtime.request('carol', path, 'POST', cohostInput)).status,
  ).toBe(409);
  // Creator blocks hide already-sent notifications and deny future sends.
  await runtime.db.prepare("INSERT INTO block VALUES('bob','alice',1)").run();
  expect(await activity('bob')).toEqual([]);
  expect(
    (
      await runtime.request('alice', path, 'POST', {
        id: crypto.randomUUID(),
        body: 'Another update',
      })
    ).status,
  ).toBe(200);
  expect(await activity('bob')).toEqual([]);
  await runtime.request('alice', `/api/events/${id}/cancel`, 'POST', {
    messageId: crypto.randomUUID(),
  });
  expect(
    (
      await runtime.request('alice', path, 'POST', {
        id: crypto.randomUUID(),
        body: 'Too late',
      })
    ).status,
  ).toBe(409);
  expect(sent).toEqual([]);
});

it('rolls back a host blast when notification fan-out fails and enforces the shared daily message limit', async () => {
  const { id, token } = await event();
  await respond('bob', id, 'going', token);
  const path = `/api/events/${id}/notifications`;
  const input = { id: crypto.randomUUID(), body: 'Doors at 7' };
  await runtime.db.exec(
    "CREATE TRIGGER fail_blast BEFORE INSERT ON activity_source WHEN NEW.kind='event_message' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;",
  );
  expect((await runtime.request('alice', path, 'POST', input)).status).toBe(
    500,
  );
  expect(
    await runtime.db
      .prepare('SELECT COUNT(*) AS n FROM event_message WHERE id=?')
      .bind(input.id)
      .first('n'),
  ).toBe(0);
  expect(await activity('bob')).toEqual([]);
  await runtime.db.exec('DROP TRIGGER fail_blast');
  expect((await runtime.request('alice', path, 'POST', input)).status).toBe(
    200,
  );
  await runtime.db.batch(
    Array.from({ length: 99 }, () =>
      runtime.db
        .prepare(
          "INSERT INTO event_message(id,event_id,user_id,kind,body,created_at) VALUES(?,?,'alice','message','synthetic',?)",
        )
        .bind(crypto.randomUUID(), id, Date.now()),
    ),
  );
  expect((await runtime.request('alice', path, 'POST', input)).status).toBe(
    200,
  );
  expect(
    (
      await runtime.request('alice', path, 'POST', {
        ...input,
        id: crypto.randomUUID(),
      })
    ).status,
  ).toBe(409);
});

it('lets people join only by signing in through an event link, recording the link', async () => {
  const { id, token } = await event();
  const linkId = await linkVersion(id);
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

  // A new link version before verification rejects the pending email.
  await requestEmail('frank@example.com');
  await newLinkVersion(id);
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
  expect(await check(other.token)).toMatchObject({ id: other.id, open: false });
  expect((await requestEmail('gina@example.com', other.token)).status).toBe(
    403,
  );
  expect((await requestEmail('bob@example.com', other.token)).status).toBe(200);
});

it('deletes an event for everyone, revokes warm media and activity, and cleans up its cover', async () => {
  const { id, token } = await event();
  const version = await linkVersion(id);
  await respond('bob', id, 'going', token);
  await open('david', token);
  await message('alice', id, 'Dinner is ready');
  expect(await activity('bob')).toHaveLength(1);
  expect(await unread('bob')).toBe(1);
  const bucket = await runtime.worker.getR2Bucket('PHOTOS');
  const keys = [`events/${id}.webp`, `events/${id}-thumb.webp`];
  for (const key of keys) await bucket.put(key, new Uint8Array([1, 2, 3]));
  for (const size of ['', '?size=thumb']) {
    const photo = await runtime.request('bob', `/media/events/${id}${size}`);
    expect(photo.status).toBe(200);
    await photo.arrayBuffer();
  }
  const cache = await (
    await runtime.worker.getCaches()
  ).open('slowmass-private-images-v1');
  for (const key of keys)
    await expect
      .poll(async () =>
        Boolean(
          await cache.match(
            `http://localhost:8787/media/_objects/${encodeURIComponent(key)}`,
          ),
        ),
      )
      .toBe(true);

  const remove = () => runtime.request('alice', `/api/events/${id}`, 'DELETE');
  expect(
    (await Promise.all([remove(), remove()])).map((r) => r.status),
  ).toEqual([200, 200]);
  for (const actor of ['alice', 'bob', 'david']) {
    expect((await runtime.request(actor, `/api/events/${id}`)).status).toBe(
      404,
    );
    expect(
      (await runtime.request(actor, `/api/events/${id}/calendar.ics`)).status,
    ).toBe(404);
    expect(await (await runtime.request(actor, '/api/events')).json()).toEqual({
      items: [],
      next: null,
    });
    expect(await activity(actor)).toEqual([]);
    expect(await unread(actor)).toBe(0);
  }
  for (const size of ['', '?size=thumb'])
    expect(
      (await runtime.request('bob', `/media/events/${id}${size}`)).status,
    ).toBe(404);
  expect(
    (await runtime.request(null, '/api/event-link/photo', 'POST', { token }))
      .status,
  ).toBe(404);
  expect(await check(token)).toBeNull();
  expect((await open('bob', token)).status).toBe(404);
  expect((await respond('bob', id, 'maybe')).status).toBe(409);
  expect((await message('alice', id, 'Too late')).response.status).toBe(409);
  expect(
    await (
      await runtime.request('bob', `/api/events/${id}/guests?status=going`)
    ).json(),
  ).toEqual({ items: [], next: null });
  expect(
    await (await runtime.request('bob', `/api/events/${id}/activity`)).json(),
  ).toEqual({ items: [], next: null });
  expect(
    await runtime.db
      .prepare(
        'SELECT state,title,description,location,object_key,thumbnail_key,link_encrypted,link_id FROM event WHERE id=?',
      )
      .bind(id)
      .first(),
  ).toEqual({
    state: 'deleted',
    title: 'Deleted event',
    description: '',
    location: '',
    object_key: null,
    thumbnail_key: null,
    link_encrypted: null,
    link_id: version,
  });
  expect(
    (
      await runtime.db
        .prepare(
          "SELECT object_key FROM photo_cleanup WHERE object_key LIKE 'events/%' ORDER BY object_key",
        )
        .all()
    ).results,
  ).toEqual([...keys].sort().map((object_key) => ({ object_key })));
  await cleanupEvents(
    runtime.db as unknown as D1Database,
    bucket as unknown as R2Bucket,
  );
  for (const key of keys) expect(await bucket.get(key)).toBeNull();
  expect((await remove()).status).toBe(200);
  expect(
    await runtime.db
      .prepare(
        "SELECT COUNT(*) AS n FROM photo_cleanup WHERE object_key LIKE 'events/%'",
      )
      .first('n'),
  ).toBe(0);
});

it('allows only the active creator to delete, including after cancellation or the event ends', async () => {
  const { id, token } = await event();
  const remove = (actor: string | null) =>
    runtime.request(actor, `/api/events/${id}`, 'DELETE');
  expect((await remove(null)).status).toBe(401);
  expect((await remove('carol')).status).toBe(404);
  await respond('bob', id, 'going', token);
  expect((await remove('bob')).status).toBe(404);
  await runtime.request('alice', `/api/events/${id}/hosts`, 'POST', {
    email: 'bob@example.com',
  });
  expect((await remove('bob')).status).toBe(404);
  expect(
    (await runtime.request('bob', `/api/events/${id}/hosting`, 'POST')).status,
  ).toBe(200);
  expect((await remove('bob')).status).toBe(404);
  await runtime.request('alice', `/api/events/${id}/hosts/bob`, 'DELETE');
  expect((await remove('bob')).status).toBe(404);
  await runtime.db.prepare("INSERT INTO block VALUES('alice','bob',1)").run();
  expect((await remove('bob')).status).toBe(404);
  expect(
    (
      await runtime.request('alice', `/api/events/${id}`, 'DELETE', undefined, {
        Origin: 'https://elsewhere.example',
      })
    ).status,
  ).toBe(403);
  expect(
    await runtime.db
      .prepare('SELECT state FROM event WHERE id=?')
      .bind(id)
      .first('state'),
  ).toBe('published');
  expect(
    await runtime.db
      .prepare(
        "SELECT COUNT(*) AS n FROM photo_cleanup WHERE object_key LIKE 'events/%'",
      )
      .first('n'),
  ).toBe(0);

  expect(
    (
      await runtime.request('alice', `/api/events/${id}/cancel`, 'POST', {
        messageId: crypto.randomUUID(),
      })
    ).status,
  ).toBe(200);
  expect((await remove('alice')).status).toBe(200);
  const past = await event(details({ startsAt: Date.now() - 2 * day }));
  expect(
    (await runtime.request('alice', `/api/events/${past.id}`, 'DELETE')).status,
  ).toBe(200);
  expect(
    await (await runtime.request('alice', '/api/events?when=past')).json(),
  ).toEqual({ items: [], next: null });
  const pending = await draft();
  expect(
    (await runtime.request('alice', `/api/events/${pending.id}`, 'DELETE'))
      .status,
  ).toBe(200);

  await runtime.db
    .prepare("UPDATE session SET expiresAt='2000-01-01' WHERE userId='alice'")
    .run();
  expect((await remove('alice')).status).toBe(401);
  await runtime.db
    .prepare("UPDATE membership SET status='disabled' WHERE user_id='alice'")
    .run();
  expect(
    await deleteEvent(runtime.db as unknown as D1Database, 'alice', id),
  ).toBe(false);
});

it('rolls back deletion and media cleanup intent together when the write fails', async () => {
  const { id } = await event();
  await runtime.db
    .prepare(
      "CREATE TRIGGER fail_event_delete BEFORE UPDATE OF state ON event WHEN NEW.state='deleted' BEGIN SELECT RAISE(ABORT,'synthetic_delete_failure'); END",
    )
    .run();
  await expect(
    deleteEvent(runtime.db as unknown as D1Database, 'alice', id),
  ).rejects.toThrow('synthetic_delete_failure');
  expect((await runtime.request('alice', `/api/events/${id}`)).status).toBe(
    200,
  );
  expect(
    await runtime.db
      .prepare(
        "SELECT COUNT(*) AS n FROM photo_cleanup WHERE object_key LIKE 'events/%'",
      )
      .first('n'),
  ).toBe(0);
  await runtime.db.prepare('DROP TRIGGER fail_event_delete').run();
  expect(
    (await runtime.request('alice', `/api/events/${id}`, 'DELETE')).status,
  ).toBe(200);
});

it('preserves admitted members and link provenance but rejects pending sign-ins after deletion', async () => {
  const { id, token } = await event();
  const requestEmail = (email: string) =>
    runtime.request(
      null,
      '/api/auth/sign-in/magic-link',
      'POST',
      {
        email,
        callbackURL: `/#event/${id}`,
        errorCallbackURL: '/?error=event',
        metadata: { eventLink: token },
      },
      { 'CF-Connecting-IP': `192.0.2.${++ip}` },
    );
  const verify = () =>
    runtime.worker.dispatchFetch(
      new URL(sent.at(-1)!.text.match(/https?:\/\/\S+/)![0]).toString(),
      {
        headers: { 'CF-Connecting-IP': `192.0.2.${++ip}` },
        redirect: 'manual',
      },
    );
  expect((await requestEmail('joined@example.com')).status).toBe(200);
  expect((await verify()).status).toBe(302);
  const snapshot = async () => ({
    invitations: (
      await runtime.db
        .prepare('SELECT * FROM invitation WHERE event_id=?')
        .bind(id)
        .all()
    ).results,
    memberships: (
      await runtime.db
        .prepare('SELECT * FROM membership ORDER BY user_id')
        .all()
    ).results,
    link: await runtime.db
      .prepare(
        'SELECT creator_id,link_id,link_hash,created_at FROM event WHERE id=?',
      )
      .bind(id)
      .first(),
  });
  const before = await snapshot();
  expect(before.invitations).toHaveLength(1);
  expect((await requestEmail('pending@example.com')).status).toBe(200);
  expect(
    (await runtime.request('alice', `/api/events/${id}`, 'DELETE')).status,
  ).toBe(200);
  expect((await verify()).headers.get('Location')).toMatch(/\/\?error=event$/);
  expect(await snapshot()).toEqual(before);
  expect((await requestEmail('new@example.com')).status).toBe(403);
  expect(
    await runtime.db
      .prepare(
        "SELECT 1 FROM membership m JOIN user u ON u.id=m.user_id WHERE u.email='pending@example.com'",
      )
      .first(),
  ).toBeNull();
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

it('authorizes preview cover bytes through the current link, including warm cache revocation', async () => {
  const { id, token } = await event(
    details({ startsAt: Date.UTC(2030, 0, 5, 3) }),
  );
  const bucket = await runtime.worker.getR2Bucket('PHOTOS');
  await bucket.put(`events/${id}-thumb.webp`, new Uint8Array([1, 2, 3]));
  const cover = (credential = token, actor: string | null = null) =>
    runtime.request(actor, '/api/event-link/photo', 'POST', {
      token: credential,
    });
  const preview = await check(token);
  expect(preview).toEqual({
    id,
    open: true,
    preview: {
      appearance: originalAppearance,
      title: 'Dinner',
      date: 'Friday, January 4, 2030',
      width: 4,
      height: 3,
    },
  });
  const response = await cover();
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(response.headers.get('content-type')).toBe('image/webp');
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(
    new Uint8Array([1, 2, 3]),
  );
  const cache = await (
    await runtime.worker.getCaches()
  ).open('slowmass-private-images-v1');
  const cacheUrl = `http://localhost:8787/media/_objects/${encodeURIComponent(`events/${id}-thumb.webp`)}`;
  await expect
    .poll(async () => Boolean(await cache.match(cacheUrl)))
    .toBe(true);
  await bucket.delete(`events/${id}-thumb.webp`);
  const warm = await cover();
  expect(warm.status).toBe(200);
  expect(warm.headers.get('Server-Timing')).toContain('desc="hit"');
  await warm.arrayBuffer();
  expect((await cover('x'.repeat(48))).status).toBe(404);
  expect((await cover(id)).status).toBe(404);
  expect((await runtime.request(null, '/api/event-link/photo')).status).toBe(
    404,
  );
  expect(
    (
      await runtime.request(
        null,
        '/api/event-link/photo',
        'POST',
        { token },
        { Origin: 'https://elsewhere.example' },
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await runtime.request(null, '/api/event-link/photo', 'POST', {
        token: 'x'.repeat(1200),
      })
    ).status,
  ).toBe(413);
  // Reading a preview never creates an event-access row or membership.
  expect(
    await runtime.db
      .prepare('SELECT COUNT(*) AS n FROM event_access')
      .first('n'),
  ).toBe(0);
  await runtime.db
    .prepare(
      "INSERT INTO block(blocker_id,target_id,created_at) VALUES('alice','bob',?)",
    )
    .bind(Date.now())
    .run();
  expect((await cover(token, 'bob')).status).toBe(404);
  expect(
    await (
      await runtime.request('bob', '/api/event-link', 'POST', { token })
    ).json(),
  ).toEqual({ event: null });
  await runtime.db.prepare("DELETE FROM block WHERE target_id='bob'").run();
  // A replacement uses only the current processed cover.
  await bucket.put('events/replacement-thumb.webp', new Uint8Array([4, 5]));
  await runtime.db
    .prepare(
      "UPDATE event SET thumbnail_key='events/replacement-thumb.webp' WHERE id=?",
    )
    .bind(id)
    .run();
  expect(new Uint8Array(await (await cover()).arrayBuffer())).toEqual(
    new Uint8Array([4, 5]),
  );
  await runtime.db
    .prepare("UPDATE membership SET status='disabled' WHERE user_id='alice'")
    .run();
  expect(await check(token)).toBeNull();
  expect((await cover()).status).toBe(404);
  await runtime.db
    .prepare("UPDATE membership SET status='active' WHERE user_id='alice'")
    .run();
  await newLinkVersion(id);
  expect(await check(token)).toBeNull();
  expect((await cover()).status).toBe(404);
});

it('keeps unpublished and deleted events out of previews and closes admission without leaking details', async () => {
  const { id, token } = await event();
  for (const state of ['pending', 'deleted']) {
    await runtime.db
      .prepare('UPDATE event SET state=? WHERE id=?')
      .bind(state, id)
      .run();
    expect(await check(token)).toBeNull();
    expect(
      (await runtime.request(null, '/api/event-link/photo', 'POST', { token }))
        .status,
    ).toBe(404);
  }
  await runtime.db
    .prepare("UPDATE event SET state='published',cancelled_at=? WHERE id=?")
    .bind(Date.now(), id)
    .run();
  expect(await check(token)).toMatchObject({
    open: false,
    preview: { title: 'Dinner' },
  });
  await runtime.db
    .prepare('UPDATE event SET cancelled_at=NULL,starts_at=? WHERE id=?')
    .bind(Date.now() - 2 * day, id)
    .run();
  expect(await check(token)).toMatchObject({ open: false });
  await runtime.db
    .prepare('UPDATE event SET starts_at=? WHERE id=?')
    .bind(Date.now() + day, id)
    .run();
  await runtime.db.prepare("DELETE FROM avatar WHERE user_id='alice'").run();
  expect(await check(token)).toMatchObject({ open: false });
});

it('exports a private calendar copy for hosts and event-only viewers without RSVP or invitation credentials', async () => {
  const startsAt = Date.UTC(2030, 2, 10, 9, 30);
  const { id, token, url } = await event(
    details({ startsAt, endsAt: startsAt + 7200000 }),
  );
  const path = `/api/events/${id}/calendar.ics`;
  expect((await runtime.request(null, path)).status).toBe(401);
  expect((await runtime.request('bob', path)).status).toBe(404);
  expect((await runtime.request('david', path)).status).toBe(404);
  await open('david', token);
  for (const actor of ['alice', 'david']) {
    const response = await runtime.request(actor, path);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe(
      'text/calendar; charset=utf-8',
    );
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('Content-Disposition')).toBe(
      'attachment; filename="slowmass-event.ics"',
    );
    const file = (await response.text()).replace(/\r\n /g, '');
    expect(file).toContain(`UID:${id}@localhost\r\n`);
    expect(file).toContain('SUMMARY:Dinner\r\n');
    expect(file).toContain(
      'DTSTART:20300310T093000Z\r\nDTEND:20300310T113000Z',
    );
    expect(file).toContain('LOCATION:1 Main St\r\n');
    expect(file).toContain('DESCRIPTION:Bring a dish');
    expect(file).toContain(`URL:http://localhost:8787/#event/${id}\r\n`);
    expect(file).not.toContain(token);
    expect(file).not.toContain(url);
    expect(file).not.toContain('@example.com');
    expect(file).not.toContain('ATTENDEE:');
  }
  expect(
    await runtime.db
      .prepare('SELECT COUNT(*) AS count FROM event_response')
      .first('count'),
  ).toBe(0);
  const again = await runtime.request('david', path);
  expect(await again.text()).toContain(`UID:${id}@localhost`);
  await newLinkVersion(id);
  expect((await runtime.request('david', path)).status).toBe(404);
});

it('rechecks calendar access after blocks, removal, expired sessions and inactive membership', async () => {
  const { id, token } = await event();
  const path = `/api/events/${id}/calendar.ics`;
  await open('bob', token);
  expect((await runtime.request('bob', path)).status).toBe(200);
  for (const pair of [
    ['alice', 'bob'],
    ['bob', 'alice'],
  ]) {
    await runtime.db
      .prepare('INSERT INTO block VALUES(?,?,1)')
      .bind(...pair)
      .run();
    expect((await runtime.request('bob', path)).status).toBe(404);
    await runtime.db.prepare('DELETE FROM block').run();
  }
  await runtime.db
    .prepare("DELETE FROM event_access WHERE user_id='bob'")
    .run();
  expect((await runtime.request('bob', path)).status).toBe(404);
  await open('bob', token);
  await runtime.db
    .prepare("UPDATE membership SET status='disabled' WHERE user_id='alice'")
    .run();
  expect((await runtime.request('bob', path)).status).toBe(404);
  await runtime.db
    .prepare("UPDATE membership SET status='active' WHERE user_id='alice'")
    .run();
  await runtime.db
    .prepare("UPDATE session SET expiresAt=? WHERE userId='bob'")
    .bind(new Date(0).toISOString())
    .run();
  expect((await runtime.request('bob', path)).status).toBe(401);
});

it('does not export unpublished, deleted or cancelled events, including after a successful download', async () => {
  const { id } = await draft();
  const path = `/api/events/${id}/calendar.ics`;
  expect((await runtime.request('alice', path)).status).toBe(404);
  await publish(id);
  expect((await runtime.request('alice', path)).status).toBe(200);
  await runtime.request('alice', `/api/events/${id}/cancel`, 'POST', {
    messageId: crypto.randomUUID(),
  });
  expect((await runtime.request('alice', path)).status).toBe(404);
  const deleted = await event();
  await runtime.db
    .prepare("UPDATE event SET state='deleted' WHERE id=?")
    .bind(deleted.id)
    .run();
  expect(
    (await runtime.request('alice', `/api/events/${deleted.id}/calendar.ics`))
      .status,
  ).toBe(404);
});
