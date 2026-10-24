import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { Env } from '../../env';
import { memberGate } from '../../auth';
import {
  markRead,
  dismissFollowBack,
  notificationPage,
  notificationStart,
  validNotificationKey,
  parsePage,
  unreadCount,
  type ReadReceipt,
} from './index';
import {
  parsePreference,
  readPreferences,
  savePreference,
  unsubscribe as unsubscribeEmail,
} from './preferences';
export const notifications = new Hono<{
  Bindings: Env;
  Variables: { userId: string };
}>();
// Members without a profile photo see activity for events they answered;
// every row is still authorized by its own visibility rules.
notifications.use('*', memberGate(false));
// Older open clients cannot render newer activity kinds.
function kinds(c: { req: { query: (name: string) => string | undefined } }) {
  return {
    joined: c.req.query('includeJoined') === '1',
    events: c.req.query('includeEvents') === '1',
  };
}
notifications.get('/', async (c) => {
  const filter = c.req.query('filter') ?? 'all';
  if (filter !== 'all' && filter !== 'requests')
    return c.json({ error: 'Invalid activity filter.' }, 400);
  let cursor;
  try {
    cursor = parsePage(c.req.query('cursor'));
  } catch {
    return c.json({ error: 'Invalid page.' }, 400);
  }
  const focus = c.req.query('focus');
  if (focus && !validNotificationKey(focus))
    return c.json({ error: 'Invalid notification.' }, 400);
  let focusFound = true;
  if (focus && !cursor) {
    cursor = await notificationStart(
      c.env.DB,
      c.get('userId'),
      focus,
      kinds(c),
    );
    focusFound = cursor !== null;
  }
  return c.json({
    ...(await notificationPage(
      c.env.DB,
      c.get('userId'),
      cursor,
      filter,
      kinds(c),
    )),
    ...(focus ? { focusFound } : {}),
  });
});

notifications.get('/unread-count', async (c) =>
  c.json({
    count: await unreadCount(c.env.DB, c.get('userId'), kinds(c)),
  }),
);
notifications.post('/read', bodyLimit({ maxSize: 6000 }), async (c) => {
  const body: unknown = await c.req.json().catch(() => null);
  if (
    !body ||
    typeof body !== 'object' ||
    !('items' in body) ||
    !Array.isArray(body.items) ||
    body.items.length === 0 ||
    body.items.length > 20 ||
    !body.items.every(
      (item: unknown) =>
        item &&
        typeof item === 'object' &&
        'key' in item &&
        typeof item.key === 'string' &&
        validNotificationKey(item.key) &&
        'version' in item &&
        typeof item.version === 'number' &&
        Number.isSafeInteger(item.version) &&
        item.version > 0,
    )
  )
    return c.json({ error: 'Invalid read receipts.' }, 400);
  await markRead(c.env.DB, c.get('userId'), body.items as ReadReceipt[]);
  return c.json({ ok: true });
});

notifications.post(
  '/dismiss-follow-back',
  bodyLimit({ maxSize: 1000 }),
  async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    if (
      !body ||
      typeof body !== 'object' ||
      !('key' in body) ||
      typeof body.key !== 'string' ||
      !validNotificationKey(body.key) ||
      !body.key.startsWith('follower:') ||
      !('version' in body) ||
      typeof body.version !== 'number' ||
      !Number.isSafeInteger(body.version) ||
      body.version <= 0
    ) {
      return c.json({ error: 'Invalid follow-back dismissal.' }, 400);
    }
    await dismissFollowBack(c.env.DB, c.get('userId'), {
      key: body.key,
      version: body.version,
    });
    return c.json({ ok: true });
  },
);

notifications.get('/preferences', async (c) =>
  c.json({ preferences: await readPreferences(c.env.DB, c.get('userId')) }),
);
notifications.put('/preferences', bodyLimit({ maxSize: 256 }), async (c) => {
  const preference = parsePreference(await c.req.json().catch(() => null));
  if (!preference)
    return c.json({ error: 'Invalid notification setting.' }, 400);
  if (!(await savePreference(c.env.DB, c.get('userId'), preference)))
    return c.json({ error: 'Sign in to continue.' }, 401);
  return c.json({ preference });
});

// Unsubscribing needs no session: the token in each email authorizes exactly
// one member's email for one category. Mail providers send the RFC 8058
// one-click POST to /:token without an Origin header, so the composition root
// exempts this route from its origin check; GET never changes anything, since
// link scanners fetch URLs in email.
export const unsubscribe = new Hono<{ Bindings: Env }>();
async function stop(c: Context<{ Bindings: Env }>, token: unknown) {
  if (typeof token !== 'string' || token.length > 200 || !c.env.AUTH_SECRET)
    return c.json({ error: 'This unsubscribe link isn’t valid.' }, 400);
  const category = await unsubscribeEmail(c.env.DB, c.env.AUTH_SECRET, token);
  return category
    ? c.json({ category })
    : c.json({ error: 'This unsubscribe link isn’t valid.' }, 400);
}
unsubscribe.use('*', bodyLimit({ maxSize: 1024 }));
unsubscribe.post('/', async (c) => {
  const body: unknown = await c.req.json().catch(() => null);
  return stop(
    c,
    body && typeof body === 'object' && 'token' in body ? body.token : null,
  );
});
unsubscribe.post('/:token', (c) => stop(c, c.req.param('token')));
