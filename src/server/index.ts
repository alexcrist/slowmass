import { diagnostics } from './diagnostics/router';
import { cleanupDiagnostics } from './diagnostics';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { handleAuthRequest, AuthUnavailableError, cleanupAuth } from './auth';
import { authConfigured } from './auth/options';
import { cleanupAccounts } from './features/account';
import { account, bootstrap } from './features/account/router';
import { avatars, avatarMedia } from './features/avatars/router';
import { cleanupAvatars } from './features/avatars';
import { posts, postMedia } from './features/posts/router';
import { cleanupPosts, backfillThumbnail } from './features/posts';
import { cleanupEmailBudgets } from './email';
import { interactions } from './features/interactions/router';
import { notifications } from './features/notifications/router';
import { people } from './features/people/router';
import { push, pushAfterMutation } from './features/push/router';
import { dispatchPush } from './features/push';
import { deviceSetup } from './features/device-setup/router';
import {
  events,
  eventMedia,
  eventLinks,
  eventShares,
} from './features/events/router';
import { cleanupEvents } from './features/events';
import { inviteLinks } from './features/invite-links/router';
import { cleanupInviteLinks } from './features/invite-links';
import type { Env } from './env';
import { measuredEnvironment, performanceMetrics } from './telemetry';

const app = new Hono<{ Bindings: Env }>();
app.use('*', performanceMetrics);
app.use('/api/*', pushAfterMutation);

app.use('*', async (c, next) => {
  const requestId = crypto.randomUUID();
  c.header('X-Request-Id', requestId);
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Robots-Tag', 'noindex, nofollow');
  c.header('Referrer-Policy', 'no-referrer');
  c.header('Cache-Control', 'private, no-store');
  c.header(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  );
  if (
    c.env.MAINTENANCE_MODE === 'true' &&
    (c.req.path.startsWith('/api/') ||
      c.req.path.startsWith('/media/') ||
      c.req.path.startsWith('/event/'))
  )
    return c.json(
      { error: 'Maintenance in progress. Please try again shortly.' },
      503,
    );
  if (
    !['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) &&
    c.req.header('Origin') !== c.env.APP_ORIGIN
  ) {
    return c.json({ error: 'Request origin is not allowed.' }, 403);
  }
  await next();
});

app.get('/api/status', (c) =>
  c.json({ signInAvailable: authConfigured(c.env) }),
);
app.use('/api/auth/*', bodyLimit({ maxSize: 4096 }));
app.on(['GET', 'POST'], '/api/auth/*', async (c) => {
  if (!authConfigured(c.env))
    return c.json({ error: 'Sign-in is not available yet.' }, 503);
  const response = await handleAuthRequest(c.env, c.req.raw);
  // Preserve our privacy headers when returning the auth library's raw response.
  response.headers.set('Cache-Control', 'private, no-store');
  return c.newResponse(response.body, response);
});
app.route('/api/me', account);
app.route('/api/bootstrap', bootstrap);
app.route('/api/startup-diagnostics', diagnostics);
app.route('/api/people', people);
app.route('/api/avatar', avatars);
app.route('/api/posts', posts);
app.route('/api/interactions', interactions);
app.route('/api/notifications', notifications);
app.route('/api/push', push);
app.route('/api/device-setup', deviceSetup);
app.route('/api/events', events);
app.route('/api/event-link', eventLinks);
app.route('/event', eventShares);
app.route('/api/invite-link', inviteLinks);
app.route('/media/posts', postMedia);
app.route('/media/avatar', avatarMedia);
app.route('/media/events', eventMedia);
// No media route is public, even before media implementation exists.
app.all('/media/*', (c) => c.json({ error: 'Not found.' }, 404));
app.all('/api/*', (c) => c.json({ error: 'Not found.' }, 404));
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));
app.onError((error, c) => {
  if (error instanceof AuthUnavailableError)
    return c.json({ error: error.message }, 503);
  console.error(
    JSON.stringify({
      event: 'request.failed',
      requestId: c.res.headers.get('X-Request-Id'),
      errorType: error.name,
    }),
  );
  return c.json({ error: 'Something went wrong. Please try again.' }, 500);
});
export default {
  fetch: (request: Request, env: Env, context: ExecutionContext) =>
    app.fetch(request, measuredEnvironment(env), context),
  scheduled: async (controller: ScheduledController, env: Env) => {
    if (env.MAINTENANCE_MODE === 'true') return;
    if (controller.cron === '0 * * * *') {
      await dispatchPush(env);
      return;
    }
    if (controller.cron !== '*/15 * * * *') return;
    await cleanupDiagnostics(env.DB);
    await cleanupAccounts(env.DB);
    await cleanupAvatars(env.DB, env.PHOTOS);
    await cleanupPosts(env.DB, env.PHOTOS);
    await backfillThumbnail(env);
    await cleanupEvents(env.DB, env.PHOTOS);
    await cleanupInviteLinks(env.DB);
    await cleanupAuth(env.DB);
    await cleanupEmailBudgets(env.DB);
  },
};
