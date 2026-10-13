import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { Env } from '../../env';
import { getActiveSession } from '../../auth';
import { authConfigured } from '../../auth/options';
import { findPost } from '../posts';
import {
  likePage,
  addComment,
  commentPage,
  removeComment,
  setLike,
  setCommentLike,
  commentLikeCounts,
  commentLikePage,
} from './index';
export const interactions = new Hono<{
  Bindings: Env;
  Variables: { userId: string };
}>();
interactions.use('*', async (c, next) => {
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
interactions.use('*', bodyLimit({ maxSize: 6000 }));
interactions.on(['PUT', 'DELETE'], '/:postId/like', async (c) => {
  const actor = c.get('userId'),
    id = c.req.param('postId');
  if (!(await setLike(c.env.DB, actor, id, c.req.method === 'PUT')))
    return c.json({ error: 'Post not found.' }, 404);
  const post = await findPost(c.env.DB, actor, id);
  if (!post || post.state !== 'published')
    return c.json({ error: 'Post not found.' }, 404);
  return c.json({
    ok: true,
    likeCount: post.likeCount,
    commentCount: post.commentCount,
    liked: post.liked,
  });
});
interactions.get('/:postId/likes', async (c) => {
  const actor = c.get('userId'),
    id = c.req.param('postId'),
    after = c.req.query('after') ?? '';
  if (after && !/^[a-z0-9_]{3,30}$/.test(after))
    return c.json({ error: 'Invalid page.' }, 400);
  const post = await findPost(c.env.DB, actor, id, false);
  if (!post || post.state !== 'published')
    return c.json({ error: 'Post not found.' }, 404);
  return c.json(await likePage(c.env.DB, actor, id, after));
});
interactions.get('/:postId/comments', async (c) => {
  const actor = c.get('userId'),
    id = c.req.param('postId'),
    after = c.req.query('after') ?? '';
  if (
    after &&
    (!/^\d{1,16}:[a-f0-9-]{36}$/.test(after) ||
      !Number.isSafeInteger(Number(after.split(':')[0])))
  )
    return c.json({ error: 'Invalid page.' }, 400);
  const post = await findPost(c.env.DB, actor, id, false);
  if (!post || post.state !== 'published')
    return c.json({ error: 'Post not found.' }, 404);
  return c.json(await commentPage(c.env.DB, actor, id, after));
});
interactions.post('/:postId/comments', async (c) => {
  const data: unknown = await c.req.json().catch(() => null);
  if (
    !data ||
    typeof data !== 'object' ||
    !('id' in data) ||
    typeof data.id !== 'string' ||
    !/^[a-f0-9-]{36}$/.test(data.id) ||
    !('body' in data) ||
    typeof data.body !== 'string' ||
    !data.body.trim() ||
    data.body.length > 1000
  )
    return c.json({ error: 'Write a comment of 1–1,000 characters.' }, 400);
  const actor = c.get('userId'),
    postId = c.req.param('postId');
  const post = await findPost(c.env.DB, actor, postId, false);
  if (!post || post.state !== 'published')
    return c.json({ error: 'Post not found.' }, 404);
  if (!(await addComment(c.env.DB, actor, postId, data.id, data.body.trim())))
    return c.json(
      {
        error:
          'Comment could not be added. You may have reached the daily limit of 100 comments.',
      },
      409,
    );
  return c.json({ ok: true });
});
interactions.on(['PUT', 'DELETE'], '/comments/:id/like', async (c) => {
  const counts = await setCommentLike(
    c.env.DB,
    c.get('userId'),
    c.req.param('id'),
    c.req.method === 'PUT',
  );
  return counts ? c.json(counts) : c.json({ error: 'Comment not found.' }, 404);
});
interactions.get('/comments/:id/likes', async (c) => {
  const actor = c.get('userId'),
    id = c.req.param('id'),
    after = c.req.query('after') ?? '';
  if (after && !/^[a-z0-9_]{3,30}$/.test(after))
    return c.json({ error: 'Invalid page.' }, 400);
  if (!(await commentLikeCounts(c.env.DB, actor, id)))
    return c.json({ error: 'Comment not found.' }, 404);
  return c.json(await commentLikePage(c.env.DB, actor, id, after));
});
interactions.delete('/comments/:id', async (c) =>
  (await removeComment(c.env.DB, c.get('userId'), c.req.param('id')))
    ? c.json({ ok: true })
    : c.json({ error: 'Comment not found.' }, 404),
);
