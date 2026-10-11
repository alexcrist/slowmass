import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { createAuth } from './auth';
import { authConfigured } from './auth/options';
import { account } from './features/account/router';
import { invitations } from './features/invitations/router';
import type { Env } from './env';

const app = new Hono<{ Bindings: Env }>();

app.use('*', async (c, next) => {
  const requestId = crypto.randomUUID();
  c.header('X-Request-Id', requestId);
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'same-origin');
  c.header('Cache-Control', 'private, no-store');
  c.header(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
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
  const response = await createAuth(c.env).handler(c.req.raw);
  if (
    c.req.method === 'GET' &&
    c.req.path === '/api/auth/magic-link/verify' &&
    response.status >= 400
  )
    return c.redirect('/?error=signin', 303);
  return response;
});
app.route('/api/me', account);
app.route('/api/invitations', invitations);
// No media route is public, even before media implementation exists.
app.all('/media/*', (c) => c.json({ error: 'Not found.' }, 404));
app.all('/api/*', (c) => c.json({ error: 'Not found.' }, 404));
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));
app.onError((error, c) => {
  console.error(
    JSON.stringify({
      event: 'request.failed',
      requestId: c.res.headers.get('X-Request-Id'),
      errorType: error.name,
    }),
  );
  return c.json({ error: 'Something went wrong. Please try again.' }, 500);
});
export default app;
