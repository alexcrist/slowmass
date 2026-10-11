import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { getActiveUser } from '../../auth';
import { authConfigured } from '../../auth/options';
import type { Env } from '../../env';
import {
  actions,
  changeRelationship,
  findProfile,
  listConnections,
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
  const user = await getActiveUser(c.env, c.req.raw.headers);
  if (!user) return c.json({ error: 'Sign in to continue.' }, 401);
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
          'Use a 3–30 character handle (letters, numbers, underscores), a name up to 60 characters, and a bio up to 500 characters.',
      },
      400,
    );
  if (!(await saveProfile(c.env.DB, c.get('userId'), input)))
    return c.json(
      {
        error:
          'That handle is unavailable. Existing handles cannot be changed.',
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
  const actor = c.get('userId');
  if (!(await ownProfile(c.env.DB, actor)))
    return c.json({ error: 'Create your profile first.' }, 409);
  // Blocking must work even when the other person has already blocked the actor.
  const target =
    action === 'block'
      ? await c.env.DB.prepare(
          "SELECT p.user_id AS id FROM profile p JOIN membership m ON m.user_id=p.user_id WHERE p.handle=? AND m.status='active'",
        )
          .bind(c.req.param('handle').toLowerCase())
          .first<{ id: string }>()
      : action === 'unblock'
        ? await c.env.DB.prepare(
            'SELECT p.user_id AS id FROM profile p JOIN block b ON b.target_id = p.user_id WHERE p.handle = ? AND b.blocker_id = ?',
          )
            .bind(c.req.param('handle').toLowerCase(), actor)
            .first<{ id: string }>()
        : await findProfile(
            c.env.DB,
            actor,
            c.req.param('handle').toLowerCase(),
          );
  if (!target) {
    if (action === 'unblock' || action === 'block') return c.json({ ok: true });
    return c.json({ error: 'Profile not found.' }, 404);
  }
  if (
    !(await changeRelationship(
      c.env.DB,
      actor,
      target.id,
      action as FollowAction,
    ))
  )
    return c.json(
      {
        error:
          'This action is unavailable. You may have reached the limit of 100 pending requests.',
      },
      409,
    );
  return c.json({ ok: true });
});
