import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { getActiveSession } from '../../auth';
import { authConfigured } from '../../auth/options';
import type { Env } from '../../env';
import {
  actions,
  discoverPeople,
  changeRelationshipByHandle,
  findProfile,
  listConnections,
  listProfileConnections,
  ownProfile,
  parseProfile,
  saveProfile,
  type ConnectionKind,
  type FollowAction,
} from './index';

export const people = new Hono<{
  Bindings: Env;
  Variables: { userId: string };
}>();
people.use('*', async (c, next) => {
  if (!authConfigured(c.env))
    return c.json({ error: 'Sign-in is not available yet.' }, 503);
  const session = await getActiveSession(c.env, c.req.raw.headers);
  const user = session?.user;
  if (!user) return c.json({ error: 'Sign in to continue.' }, 401);
  if (c.req.path !== '/api/people/self' && !session?.hasProfilePhoto)
    return c.json(
      { error: 'Add a profile photo to finish setting up your account.' },
      409,
    );
  c.set('userId', user.id);
  await next();
});
people.use('*', bodyLimit({ maxSize: 4096 }));
people.get('/self', async (c) =>
  c.json({ profile: await ownProfile(c.env.DB, c.get('userId')) }),
);
people.put('/self', async (c) => {
  const input = parseProfile(await c.req.json().catch(() => null));
  if (!input)
    return c.json(
      {
        error:
          'Use a 3–30 character username (letters, numbers, underscores), a name up to 60 characters, and a bio up to 500 characters.',
      },
      400,
    );
  if (!(await saveProfile(c.env.DB, c.get('userId'), input)))
    return c.json(
      {
        error:
          input.handle === null
            ? 'Your name could not be saved. Try again.'
            : 'That username is unavailable. Choose another.',
      },
      409,
    );
  return c.json({ profile: await ownProfile(c.env.DB, c.get('userId')) });
});
people.get('/connections', async (c) => {
  const kind = c.req.query('kind') ?? 'requests';
  const after = c.req.query('after') ?? '';
  if (
    !['requests', 'followers', 'following', 'blocked'].includes(kind) ||
    (after && !/^[a-z0-9_]{3,30}$/.test(after))
  )
    return c.json({ error: 'Invalid page.' }, 400);
  return c.json(
    await listConnections(
      c.env.DB,
      c.get('userId'),
      kind as ConnectionKind,
      after,
    ),
  );
});
people.get('/discover', async (c) => {
  const query = (c.req.query('q') ?? '').trim().toLowerCase();
  const seed = c.req.query('seed') ?? '';
  const after = c.req.query('after') ?? '';
  if (
    (query && (query.length < 3 || query.length > 60)) ||
    !/^[a-f0-9]{32}$/.test(seed) ||
    (after && !/^[01]:[a-f0-9]{32}$/.test(after))
  )
    return c.json(
      { error: 'Enter at least 3 characters, or clear the search to browse.' },
      400,
    );
  const page = await discoverPeople(
    c.env.DB,
    c.get('userId'),
    query,
    seed,
    after,
  );
  if (!page)
    return c.json(
      { error: 'Please wait a minute before searching again.' },
      429,
    );
  return c.json(page);
});
people.get('/:handle/connections', async (c) => {
  const kind = c.req.query('kind');
  const after = c.req.query('after') ?? '';
  if (
    (kind !== 'followers' && kind !== 'following') ||
    (after && !/^[a-z0-9_]{3,30}$/.test(after))
  )
    return c.json({ error: 'Invalid page.' }, 400);
  const page = await listProfileConnections(
    c.env.DB,
    c.get('userId'),
    c.req.param('handle').toLowerCase(),
    kind,
    after,
  );
  if (!page)
    return c.json(
      { error: 'Follow this account to view its connections.' },
      404,
    );
  return c.json(page);
});
people.get('/:handle', async (c) => {
  const profile = await findProfile(
    c.env.DB,
    c.get('userId'),
    c.req.param('handle').toLowerCase(),
  );
  if (!profile) return c.json({ error: 'Profile not found.' }, 404);
  const { id: _id, ...visible } = profile;
  void _id;
  return c.json({ profile: visible });
});
people.post('/:handle/:action', async (c) => {
  const action = c.req.param('action');
  if (!actions.includes(action as FollowAction))
    return c.json({ error: 'Unknown action.' }, 400);
  const result = await changeRelationshipByHandle(
    c.env.DB,
    c.get('userId'),
    c.req.param('handle').toLowerCase(),
    action as FollowAction,
  );
  if (result === 'profile_required')
    return c.json({ error: 'Create your profile first.' }, 409);
  if (result === 'missing') return c.json({ error: 'Profile not found.' }, 404);
  if (result === 'unavailable')
    return c.json(
      {
        error:
          'This action is unavailable. You may have reached the limit of 100 pending requests.',
      },
      409,
    );
  return c.json({ ok: true });
});
