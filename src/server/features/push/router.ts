import { Hono, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { getActiveSession } from '../../auth';
import { authConfigured } from '../../auth/options';
import type { Env } from '../../env';
import { dispatchPush } from './delivery';
import { dispatchEmailNotifications } from '../notifications';
import {
  parseSubscription,
  validEndpoint,
  pushConfigured,
  removeSubscription,
  saveSubscription,
  subscriptionStatus,
} from './subscriptions';

export const push = new Hono<{
  Bindings: Env;
  Variables: { userId: string; sessionId: string };
}>();
push.use('*', async (c, next) => {
  if (!authConfigured(c.env))
    return c.json({ error: 'Sign-in is not available yet.' }, 503);
  const session = await getActiveSession(c.env, c.req.raw.headers);
  if (!session) return c.json({ error: 'Sign in to continue.' }, 401);
  // Members without a profile photo can still follow events they answered.
  c.set('userId', session.user.id);
  c.set('sessionId', session.sessionId);
  await next();
});
// Old clients can still read their sole subscription. Mutations require the
// endpoint-aware client: copied login cookies cannot identify an installation.
push.get('/', async (c) =>
  c.json({
    available: pushConfigured(c.env),
    publicKey: pushConfigured(c.env) ? c.env.PUSH_PUBLIC_KEY : null,
    subscription: await subscriptionStatus(
      c.env.DB,
      c.get('userId'),
      c.get('sessionId'),
    ),
  }),
);
push.get('/device', async (c) => {
  const endpoint = c.req.header('X-Push-Endpoint') ?? null;
  if (endpoint !== null && !validEndpoint(endpoint))
    return c.json({ error: 'Invalid push subscription.' }, 400);
  return c.json({
    available: pushConfigured(c.env),
    publicKey: pushConfigured(c.env) ? c.env.PUSH_PUBLIC_KEY : null,
    subscription: await subscriptionStatus(
      c.env.DB,
      c.get('userId'),
      c.get('sessionId'),
      endpoint,
    ),
  });
});
push.put('/device', bodyLimit({ maxSize: 4096 }), async (c) => {
  if (!pushConfigured(c.env))
    return c.json({ error: 'Push notifications are not available yet.' }, 503);
  const subscription = await parseSubscription(
    await c.req.json().catch(() => null),
  );
  if (!subscription)
    return c.json(
      { error: 'This browser returned an unsupported push subscription.' },
      400,
    );
  if (
    !(await saveSubscription(
      c.env.DB,
      c.get('userId'),
      c.get('sessionId'),
      subscription,
    ))
  )
    return c.json(
      {
        error:
          'Could not enable notifications. Disable notifications in an unused browser, or sign out and back in before trying again.',
      },
      409,
    );
  return c.json({ ok: true });
});
push.on(['PUT', 'DELETE'], '/', (c) =>
  c.json(
    {
      error: 'Reload slowmass to update notification settings.',
    },
    409,
  ),
);
push.delete('/device', async (c) => {
  const endpoint = c.req.header('X-Push-Endpoint');
  if (!endpoint || !validEndpoint(endpoint))
    return c.json({ error: 'Invalid push subscription.' }, 400);
  await removeSubscription(
    c.env.DB,
    c.get('userId'),
    c.get('sessionId'),
    endpoint,
  );
  return c.json({ ok: true });
});
// Prompt dispatch is best effort; the committed outboxes and the minute cron
// survive a lost request, process failure, or a mutation served by the
// previous deployment. Like alerts and most email wait before sending, so
// likes skip dispatch and only update blasts and cancellations email at once.
export const deliverAfterMutation: MiddlewareHandler<{
  Bindings: Env;
}> = async (c, next) => {
  await next();
  if (c.res.status >= 300) return;
  const path = c.req.path;
  const event = path.match(
    /^\/api\/events\/[^/]+\/(response|messages|update-blasts|cancel)$/,
  );
  if (
    pushConfigured(c.env) &&
    ((['POST', 'PUT', 'DELETE'].includes(c.req.method) &&
      (/^\/api\/(people|interactions)\//.test(path) ||
        path === '/api/avatar')) ||
      (c.req.method === 'POST' && event)) &&
    !path.endsWith('/like')
  )
    c.executionCtx.waitUntil(
      dispatchPush(c.env).catch(() =>
        console.error(JSON.stringify({ event: 'push.dispatch_failed' })),
      ),
    );
  if (
    c.req.method === 'POST' &&
    (event?.[1] === 'update-blasts' || event?.[1] === 'cancel')
  )
    c.executionCtx.waitUntil(
      dispatchEmailNotifications(c.env).catch(() =>
        console.error(JSON.stringify({ event: 'email.dispatch_failed' })),
      ),
    );
};
