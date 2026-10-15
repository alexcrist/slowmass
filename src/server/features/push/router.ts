import { Hono, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { getActiveSession } from '../../auth';
import { authConfigured } from '../../auth/options';
import type { Env } from '../../env';
import { dispatchPush } from './delivery';
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
  if (!session.hasProfilePhoto)
    return c.json(
      { error: 'Add a profile photo to finish setting up your account.' },
      409,
    );
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
// Prompt dispatch is best effort; the committed outbox and cron survive a lost
// request, process failure, or a mutation served by the previous deployment.
export const pushAfterMutation: MiddlewareHandler<{ Bindings: Env }> = async (
  c,
  next,
) => {
  await next();
  if (
    pushConfigured(c.env) &&
    ['POST', 'PUT', 'DELETE'].includes(c.req.method) &&
    (/^\/api\/(people|interactions)\//.test(c.req.path) ||
      c.req.path === '/api/avatar') &&
    c.res.status < 300
  )
    c.executionCtx.waitUntil(
      dispatchPush(c.env).catch(() =>
        console.error(JSON.stringify({ event: 'push.dispatch_failed' })),
      ),
    );
};
