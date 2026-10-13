import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { Env } from '../../env';
import { getActiveSession } from '../../auth';
import { authConfigured } from '../../auth/options';
import {
  markRead,
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
  if (!session?.hasProfilePhoto)
    return c.json(
      { error: 'Add a profile photo to finish setting up your account.' },
      409,
    );
  c.set('userId', user.id);
  await next();
});
notifications.get('/', async (c) => {
  // Older open clients cannot render the new activity kind.
  const includeJoined = c.req.query('includeJoined') === '1';
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
      includeJoined,
    );
    focusFound = cursor !== null;
  }
  return c.json({
    ...(await notificationPage(
      c.env.DB,
      c.get('userId'),
      cursor,
      filter,
      includeJoined,
    )),
    ...(focus ? { focusFound } : {}),
  });
});

notifications.get('/unread-count', async (c) =>
  c.json({
    count: await unreadCount(
      c.env.DB,
      c.get('userId'),
      c.req.query('includeJoined') === '1',
    ),
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
