import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { Env } from '../../env';
import { getActiveUser } from '../../auth';
import { authConfigured } from '../../auth/options';
import { markRead, notificationPage, parsePage } from './index';
export const notifications = new Hono<{
  Bindings: Env;
  Variables: { userId: string };
}>();
notifications.use('*', async (c, next) => {
  if (!authConfigured(c.env))
    return c.json({ error: 'Sign in to continue.' }, 401);
  const user = await getActiveUser(c.env, c.req.raw.headers);
  if (!user) return c.json({ error: 'Sign in to continue.' }, 401);
  c.set('userId', user.id);
  await next();
});
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
  return c.json(
    await notificationPage(c.env.DB, c.get('userId'), cursor, filter),
  );
});
notifications.post('/read', bodyLimit({ maxSize: 6000 }), async (c) => {
  const data: unknown = await c.req.json().catch(() => null);
  if (
    !data ||
    typeof data !== 'object' ||
    !('items' in data) ||
    !Array.isArray(data.items) ||
    data.items.length > 20
  )
    return c.json({ error: 'Invalid notifications.' }, 400);
  const items: { key: string; createdAt: number }[] = [];
  for (const item of data.items) {
    if (
      !item ||
      typeof item.key !== 'string' ||
      !/^(request|likes|comment):[a-zA-Z0-9-]{1,64}$/.test(item.key) ||
      !Number.isSafeInteger(item.createdAt) ||
      item.createdAt < 0 ||
      item.createdAt > Date.now()
    )
      return c.json({ error: 'Invalid notification.' }, 400);
    items.push({ key: item.key, createdAt: item.createdAt });
  }
  await markRead(c.env.DB, c.get('userId'), items);
  return c.json({ ok: true });
});
