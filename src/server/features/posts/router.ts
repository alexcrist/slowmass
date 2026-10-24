import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { Env } from '../../env';
import { memberGate, readAsMember } from '../../auth';
import { authConfigured } from '../../auth/options';
import { ownProfile, findProfile } from '../people';
import { PhotoError, privatePhoto } from '../../photos';
import {
  createDraft,
  deletePost,
  editCaption,
  findPost,
  listPosts,
  parseCursor,
  parseDraft,
  parseCaption,
  publicPost,
  publishPhoto,
} from './index';
export const posts = new Hono<{
  Bindings: Env;
  Variables: { userId: string };
}>();
export const postMedia = new Hono<{ Bindings: Env }>();
posts.use('*', memberGate(true));
posts.get('/', async (c) => {
  let cursor;
  try {
    cursor = parseCursor(c.req.query('cursor'));
  } catch {
    return c.json({ error: 'Invalid page.' }, 400);
  }
  const handle = c.req.query('handle')?.toLowerCase() ?? null;
  // The page is only returned once the profile is confirmed visible.
  const [owner, page] = await Promise.all([
    handle ? findProfile(c.env.DB, c.get('userId'), handle) : null,
    listPosts(c.env.DB, c.get('userId'), handle, cursor),
  ]);
  if (handle && (!owner || owner.bio === null))
    return c.json({ error: 'Profile not found.' }, 404);
  return c.json(page);
});
posts.post('/', bodyLimit({ maxSize: 12000 }), async (c) => {
  const draft = parseDraft(await c.req.json().catch(() => null));
  if (!draft)
    return c.json(
      {
        error:
          'Provide an upload ID, a caption up to 2,000 characters, and alt text up to 500 characters.',
      },
      400,
    );
  if (!(await ownProfile(c.env.DB, c.get('userId'))))
    return c.json({ error: 'Create your profile first.' }, 409);
  if (!c.env.IMAGES)
    return c.json({ error: 'Photo processing is unavailable.' }, 503);
  const state = await createDraft(c.env.DB, c.get('userId'), draft);
  if (state === 'quota')
    return c.json(
      { error: 'Photo upload limit reached. Try again later.' },
      429,
    );
  if (['conflict', 'failed', 'deleted'].includes(state))
    return c.json(
      {
        error:
          'This upload cannot be resumed with these details. Check My photos before choosing the file again to start a different post.',
      },
      409,
    );
  return c.json({ id: draft.id, state });
});
posts.put('/:id/photo', async (c) => {
  try {
    const state = await publishPhoto(
      c.env,
      c.get('userId'),
      c.req.param('id'),
      c.req.raw,
    );
    if (state === 'missing') return c.json({ error: 'Post not found.' }, 404);
    if (state !== 'published')
      return c.json(
        {
          error:
            'This upload is in progress or no longer available. Check your posts before trying again.',
        },
        409,
      );
    return c.json({ id: c.req.param('id'), state });
  } catch (error) {
    if (error instanceof PhotoError)
      return c.json({ error: error.message }, error.status);
    throw error;
  }
});
posts.get('/:id', async (c) => {
  const post = await findPost(c.env.DB, c.get('userId'), c.req.param('id'));
  return post
    ? c.json({ post: publicPost(post, c.get('userId')) })
    : c.json({ error: 'Post not found.' }, 404);
});
posts.patch('/:id', bodyLimit({ maxSize: 12000 }), async (c) => {
  const caption = parseCaption(await c.req.json().catch(() => null));
  if (caption === null)
    return c.json(
      { error: 'Provide only a caption of up to 2,000 characters.' },
      400,
    );
  if (
    !(await editCaption(c.env.DB, c.get('userId'), c.req.param('id'), caption))
  )
    return c.json({ error: 'Post not found.' }, 404);
  return c.json({ caption });
});
posts.delete('/:id', async (c) =>
  (await deletePost(c.env.DB, c.get('userId'), c.req.param('id')))
    ? c.json({ ok: true })
    : c.json({ error: 'Post not found.' }, 404),
);
postMedia.get('/:id', async (c) => {
  const size = c.req.query('size');
  if (size !== undefined && size !== 'grid') return c.notFound();
  if (!authConfigured(c.env)) return c.notFound();
  const read = await readAsMember(c.env, c.req.raw.headers, (viewer) =>
    findPost(c.env.DB, viewer, c.req.param('id'), false),
  );
  const post = read?.value;
  if (!post || post.state !== 'published' || !post.objectKey)
    return c.notFound();
  const response = await privatePhoto(
    c.env,
    size === 'grid' ? (post.thumbnailKey ?? post.objectKey) : post.objectKey,
    c.executionCtx,
    c.req.raw,
    // A post's photo never changes, so the device may keep it for a week.
    'immutable',
  );
  return response ?? c.notFound();
});
