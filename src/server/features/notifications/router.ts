import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { Env } from '../../env';
import { getActiveSession } from '../../auth';
import { authConfigured } from '../../auth/options';
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
export const notifications = new Hono<{
  Bindings: Env;
  Variables: { userId: string };
}>();
notifications.use('*', async (c, next) => {
  if (!authConfigured(c.env))
    return c.json({ error: 'Sign-in is not available yet.' }, 503);
  const session = await getActiveSession(c.env, c.req.raw.headers);
  const user = session?.user;
  if (!user) return c.json({ error: 'Sign in to continue.' }, 401);
  // Members without a profile photo see activity for events they answered;
  // every row is still authorized by its own visibility rules.
  c.set('userId', user.id);
  await next();
});
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
