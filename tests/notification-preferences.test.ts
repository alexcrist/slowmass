import { afterEach, beforeEach, expect, it } from 'vitest';
import { cleanupAccounts } from '../src/server/features/account';
import {
  seedProfilePhotos,
  testRuntime,
  type SentEmail,
} from './support/runtime';

let runtime: Awaited<ReturnType<typeof testRuntime>>;
let sent: SentEmail[];
beforeEach(async () => {
  sent = [];
  runtime = await testRuntime(false, false, async (email) => {
    sent.push(email);
    return { status: 200, body: '{"MessageId":"synthetic"}' };
  });
  for (const id of ['alice', 'bob', 'carol'])
    await runtime.request(id, '/api/people/self', 'PUT', {
      handle: id,
      displayName: id,
      bio: '',
    });
  await seedProfilePhotos(runtime.db);
  await runtime.db.batch([
    runtime.db.prepare('DELETE FROM follow'),
    runtime.db
      .prepare(
        "INSERT INTO post(id,user_id,caption,alt_text,created_at,published_at,state,object_key,width,height) VALUES('photo','alice','','',1,1,'published','posts/photo',1,1)",
      )
      .bind(),
  ]);
});
afterEach(async () => runtime?.worker.dispose());

const path = '/api/notifications/preferences';
async function preferences(actor = 'alice') {
  const response = await runtime.request(actor, path);
  expect(response.status).toBe(200);
  return (
    (await response.json()) as {
      preferences: { category: string; push: boolean; email: boolean }[];
    }
  ).preferences;
}
async function save(category: string, push: boolean, email: boolean) {
  return runtime.request('alice', path, 'PUT', { category, push, email });
}
async function cron() {
  expect(
    (await (await runtime.worker.getWorker()).scheduled({ cron: '* * * * *' }))
      .outcome,
  ).toBe('ok');
}
async function comment(id: string, at = Date.now()) {
  await runtime.db
    .prepare(
      "INSERT INTO comment(id,post_id,user_id,body,created_at) VALUES(?,'photo','bob','Synthetic comment',?)",
    )
    .bind(id, at)
    .run();
}
async function due() {
  await runtime.db.prepare('UPDATE email_delivery SET available_at=0').run();
}

it('returns defaults that match earlier behavior and saves validated choices', async () => {
  expect(await preferences()).toEqual([
    { category: 'request', push: true, email: false },
    { category: 'follower', push: true, email: false },
    { category: 'joined', push: true, email: false },
    { category: 'likes', push: false, email: false },
    { category: 'comment', push: true, email: false },
    { category: 'event_response', push: true, email: false },
    { category: 'event_message', push: true, email: false },
    { category: 'update_blast', push: true, email: true },
    { category: 'event_cancelled', push: true, email: false },
  ]);
  for (const body of [
    { category: 'nope', push: true, email: true },
    { category: 'comment', push: 'yes', email: true },
    { category: 'comment', push: true },
    null,
  ])
    expect((await runtime.request('alice', path, 'PUT', body)).status).toBe(
      400,
    );
  expect(
    (
      await runtime.request(null, path, 'PUT', {
        category: 'comment',
        push: false,
        email: true,
      })
    ).status,
  ).toBe(401);
  expect(await (await save('comment', false, true)).json()).toEqual({
    preference: { category: 'comment', push: false, email: true },
  });
  expect((await save('comment', false, true)).status).toBe(200);
  expect((await preferences()).find((p) => p.category === 'comment')).toEqual({
    category: 'comment',
    push: false,
    email: true,
  });
  // Other members keep their defaults; members without a photo can choose.
  expect((await preferences('bob'))[4]).toEqual({
    category: 'comment',
    push: true,
    email: false,
  });
  await runtime.db.prepare("DELETE FROM avatar WHERE user_id='bob'").run();
  expect((await preferences('bob')).length).toBe(9);
});

it('emails only unread activity, describes it, and unsubscribes one category by link', async () => {
  await comment('quiet');
  expect(
    await runtime.db
      .prepare('SELECT COUNT(*) AS n FROM email_delivery')
      .first('n'),
  ).toBe(0);
  await save('comment', true, true);
  await save('follower', true, true);
  const before = Date.now();
  await comment('seen');
  const queued = await runtime.db
    .prepare('SELECT available_at FROM email_delivery')
    .first<number>('available_at');
  // Email waits ten minutes (second-precision, like other trigger times), so
  // activity read in the app isn’t also emailed.
  expect(queued).toBeGreaterThanOrEqual(before - 1000 + 600_000);
  const items = (
    (await (await runtime.request('alice', '/api/notifications')).json()) as {
      items: { key: string; version: number }[];
    }
  ).items.filter((item) => item.key === 'comment:seen');
  await runtime.request('alice', '/api/notifications/read', 'POST', { items });
  await due();
  await cron();
  expect(sent).toEqual([]);

  await comment('fresh');
  await due();
  await cron();
  expect(sent).toHaveLength(1);
  const [email] = sent;
  expect(email).toMatchObject({
    to: ['alice@example.com'],
    bcc: [],
    subject: 'bob commented on your photo.',
  });
  expect(email.text).toContain('Synthetic comment');
  expect(email.text).toContain('http://localhost:8787/#post/photo');
  const token = /#unsubscribe\/(\S+)/.exec(email.text)![1];
  expect(token.startsWith('alice.comment.')).toBe(true);

  // Link scanners only GET; that never unsubscribes.
  expect(
    (await runtime.request(null, `/api/unsubscribe/${token}`)).status,
  ).toBe(404);
  // A token cannot be moved to another member or category.
  for (const forged of [
    token.replace('alice.', 'bob.'),
    token.replace('.comment.', '.follower.'),
    `${token.slice(0, -2)}xx`,
  ])
    expect(
      (
        await runtime.request(null, '/api/unsubscribe', 'POST', {
          token: forged,
        })
      ).status,
    ).toBe(400);
  // RFC 8058 one-click comes from the mail provider without an Origin.
  const oneClick = await runtime.worker.dispatchFetch(
    `http://localhost:8787/api/unsubscribe/${token}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'List-Unsubscribe=One-Click',
    },
  );
  expect(oneClick.status).toBe(200);
  expect(await oneClick.json()).toEqual({ category: 'comment' });
  const after = await preferences();
  expect(after.find((p) => p.category === 'comment')).toEqual({
    category: 'comment',
    push: true,
    email: false,
  });
  expect(after.find((p) => p.category === 'follower')?.email).toBe(true);
  // Repeating it, signed out from the in-app page, is harmless.
  expect(
    (await runtime.request(null, '/api/unsubscribe', 'POST', { token })).status,
  ).toBe(200);
  await comment('after');
  await due();
  await cron();
  expect(sent).toHaveLength(1);
  // Inactive members' links no longer work.
  await runtime.db
    .prepare("UPDATE membership SET status='disabled' WHERE user_id='alice'")
    .run();
  expect(
    (await runtime.request(null, '/api/unsubscribe', 'POST', { token })).status,
  ).toBe(400);
});

it('queues push by preference and coalesces likes into one delayed alert', async () => {
  await runtime.db
    .prepare(
      "INSERT INTO push_subscription(id,user_id,session_id,endpoint,p256dh,auth,created_at) VALUES('device','alice','alice','https://fcm.googleapis.com/fcm/send/synthetic','key','auth',1)",
    )
    .run();
  const deliveries = () =>
    runtime.db
      .prepare('SELECT event_key AS key,available_at AS at FROM push_delivery')
      .all<{ key: string; at: number }>()
      .then((result) => result.results);
  await comment('pushed');
  expect((await deliveries()).map((row) => row.key)).toEqual([
    'comment:pushed',
  ]);
  await save('comment', false, false);
  await comment('silent');
  expect(await deliveries()).toHaveLength(1);
  // Likes are off by default; turned on, a burst becomes one alert that a
  // later like updates without postponing.
  await runtime.db
    .prepare("INSERT INTO post_like VALUES('photo','bob',?)")
    .bind(Date.now())
    .run();
  expect(await deliveries()).toHaveLength(1);
  await save('likes', true, false);
  const before = Date.now();
  await runtime.db
    .prepare("INSERT INTO post_like VALUES('photo','carol',?)")
    .bind(Date.now())
    .run();
  const [first] = (await deliveries()).filter((row) =>
    row.key.startsWith('likes:'),
  );
  expect(first.at).toBeGreaterThanOrEqual(before - 1000 + 900_000);
  await runtime.db.prepare("DELETE FROM post_like WHERE user_id='bob'").run();
  await runtime.db
    .prepare("INSERT INTO post_like VALUES('photo','bob',?)")
    .bind(Date.now() + 5000)
    .run();
  const likes = (await deliveries()).filter((row) =>
    row.key.startsWith('likes:'),
  );
  expect(likes).toEqual([first]);
});

it('does not alert or count the member who accepts a follow request', async () => {
  await save('follower', true, true);
  await runtime.request('bob', '/api/people/alice/request', 'POST');
  await runtime.request('alice', '/api/people/bob/accept', 'POST');
  expect(
    await (
      await runtime.request('alice', '/api/notifications/unread-count')
    ).json(),
  ).toEqual({ count: 0 });
  await due();
  await cron();
  expect(sent).toEqual([]);
});

it('removes a deleted account’s choices and queued email', async () => {
  await save('comment', false, true);
  await comment('queued');
  expect(
    (
      await runtime.request('alice', '/api/me', 'DELETE', {
        confirmation: 'DELETE',
      })
    ).status,
  ).toBe(200);
  await cleanupAccounts(runtime.db);
  for (const table of ['notification_preference', 'email_delivery'])
    expect(
      await runtime.db
        .prepare(
          `SELECT COUNT(*) AS n FROM ${table} WHERE ${table === 'email_delivery' ? 'recipient_id' : 'user_id'}='alice'`,
        )
        .first('n'),
    ).toBe(0);
  await due();
  await cron();
  expect(sent).toEqual([]);
});
