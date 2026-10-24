import { Hono, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { Env } from '../../env';
import { getActiveSession, readAsMember } from '../../auth';
import { authConfigured } from '../../auth/options';
import { PhotoError, privatePhoto } from '../../photos';
import { eventShareHtml } from './share';
import {
  MAX_EVENT_HOSTS,
  acceptHosting,
  addHost,
  cancelEvent,
  checkLink,
  createEvent,
  declineHosting,
  deleteMessage,
  deleteEvent,
  eventLog,
  eventCalendar,
  eventMediaKey,
  eventPreviewMediaKey,
  eventShareTitle,
  findEvent,
  listEvents,
  listGuests,
  parseCursor,
  originalAppearance,
  parseAppearance,
  parseDetails,
  hostCandidates,
  parseMessage,
  parseStatus,
  postMessage,
  openEvent,
  removeHost,
  removePendingHost,
  respond,
  saveEventPhoto,
  sendUpdateBlast,
  UPDATE_BLASTS_PER_DAY,
  updateEvent,
  updateAppearance,
  validId,
  validLinkToken,
} from './index';

type Variables = { userId: string; complete: boolean };
export const events = new Hono<{ Bindings: Env; Variables: Variables }>();
export const eventLinks = new Hono<{
  Bindings: Env;
  Variables: { viewer: string | null };
}>();
export const eventMedia = new Hono<{ Bindings: Env }>();
export const eventShares = new Hono<{
  Bindings: Env;
  Variables: { viewer: string | null };
}>();

const notFound = { error: 'Event not found.' };

// Members without a profile photo can take part in events they opened or
// answered; creating and hosting require a finished profile.
events.use('*', async (c, next) => {
  if (!authConfigured(c.env))
    return c.json({ error: 'Sign-in is not available yet.' }, 503);
  const session = await getActiveSession(c.env, c.req.raw.headers);
  if (!session) return c.json({ error: 'Sign in to continue.' }, 401);
  c.set('userId', session.user.id);
  c.set('complete', session.hasProfilePhoto);
  await next();
});
const jsonLimit = bodyLimit({ maxSize: 12000 });
function requireComplete(complete: boolean) {
  return complete
    ? null
    : { error: 'Add a profile photo to finish setting up your account.' };
}
async function json(c: { req: { json: () => Promise<unknown> } }) {
  return c.req.json().catch(() => null);
}
const detailsError = {
  error:
    'Give the event a title up to 120 characters, a start time, an end time after it (within 30 days), a description up to 4,000 characters and a location up to 300 characters.',
};

events.get('/', async (c) => {
  const when = c.req.query('when') ?? 'upcoming';
  if (when !== 'upcoming' && when !== 'past')
    return c.json({ error: 'Invalid page.' }, 400);
  try {
    return c.json(
      await listEvents(
        c.env.DB,
        c.get('userId'),
        when,
        parseCursor(c.req.query('cursor')),
      ),
    );
  } catch {
    return c.json({ error: 'Invalid page.' }, 400);
  }
});
events.post('/', jsonLimit, async (c) => {
  const incomplete = requireComplete(c.get('complete'));
  if (incomplete) return c.json(incomplete, 409);
  const body = (await json(c)) as Record<string, unknown> | null;
  const details = parseDetails(body);
  if (!details || !validId(body?.id)) return c.json(detailsError, 400);
  const appearance =
    body.appearance === undefined
      ? originalAppearance
      : parseAppearance(body.appearance);
  if (!appearance)
    return c.json(
      { error: 'Choose an available color theme and font pairing.' },
      400,
    );
  const state = await createEvent(
    c.env,
    c.get('userId'),
    body.id,
    details,
    appearance,
  );
  if (state === 'limit')
    return c.json({ error: 'You can create up to 10 events a day.' }, 429);
  if (state === 'conflict')
    return c.json(
      { error: 'This event could not be saved. Start a new event instead.' },
      409,
    );
  return c.json({ id: body.id, state });
});
events.get('/:id', async (c) => {
  const event = await findEvent(c.env, c.get('userId'), c.req.param('id'));
  return event ? c.json({ event }) : c.json(notFound, 404);
});
events.delete('/:id', async (c) =>
  (await deleteEvent(c.env.DB, c.get('userId'), c.req.param('id')))
    ? c.json({ ok: true })
    : c.json(notFound, 404),
);
events.get('/:id/calendar.ics', async (c) => {
  const calendar = await eventCalendar(
    c.env,
    c.get('userId'),
    c.req.param('id'),
  );
  if (!calendar) return c.json(notFound, 404);
  c.header('Content-Type', 'text/calendar; charset=utf-8');
  c.header('Content-Disposition', 'attachment; filename="slowmass-event.ics"');
  return c.body(calendar);
});
events.patch('/:id/appearance', bodyLimit({ maxSize: 1024 }), async (c) => {
  const body = (await json(c)) as Record<string, unknown> | null;
  const appearance = parseAppearance(body?.appearance);
  const expected = parseAppearance(body?.expected);
  if (!appearance || !expected)
    return c.json(
      { error: 'Choose an available color theme and font pairing.' },
      400,
    );
  return (await updateAppearance(
    c.env.DB,
    c.get('userId'),
    c.req.param('id'),
    appearance,
    expected,
  ))
    ? c.json({ appearance })
    : c.json(
        {
          error:
            'Appearance could not be saved. The event may have changed or you may no longer be a host. Close this dialog and reload the event before trying again.',
        },
        409,
      );
});
events.patch('/:id', jsonLimit, async (c) => {
  const body = (await json(c)) as Record<string, unknown> | null;
  const details = parseDetails(body);
  if (!details) return c.json(detailsError, 400);
  return (await updateEvent(
    c.env.DB,
    c.get('userId'),
    c.req.param('id'),
    details,
  ))
    ? c.json({ ok: true })
    : c.json(
        {
          error:
            'This event could not be updated. It may have changed or been cancelled; reload it and try again.',
        },
        409,
      );
});
events.post('/:id/cancel', jsonLimit, async (c) => {
  const body = (await json(c)) as Record<string, unknown> | null;
  if (!validId(body?.messageId))
    return c.json({ error: 'A cancellation ID is required.' }, 400);
  return (await cancelEvent(
    c.env.DB,
    c.get('userId'),
    c.req.param('id'),
    body.messageId,
  ))
    ? c.json({ ok: true })
    : c.json(notFound, 404);
});
events.put('/:id/photo', async (c) => {
  const upload = c.req.header('Idempotency-Key') ?? '';
  if (!validId(upload))
    return c.json({ error: 'A valid upload ID is required.' }, 400);
  if (!c.env.IMAGES)
    return c.json({ error: 'Photo processing is unavailable.' }, 503);
  try {
    const state = await saveEventPhoto(
      c.env,
      c.get('userId'),
      c.req.param('id'),
      upload,
      c.req.raw,
    );
    if (state === 'done') return c.json({ ok: true });
    if (state === 'missing') return c.json(notFound, 404);
    if (state === 'quota')
      return c.json(
        { error: 'Photo upload limit reached. Try again later.' },
        429,
      );
    return c.json(
      {
        error:
          'This upload is in progress or failed. Wait before retrying, or choose the photo again.',
      },
      409,
    );
  } catch (error) {
    if (error instanceof PhotoError)
      return c.json({ error: error.message }, error.status);
    throw error;
  }
});
// Opening an event link while signed in records it and returns the event.
events.post('/open', bodyLimit({ maxSize: 1024 }), async (c) => {
  const body = (await json(c)) as Record<string, unknown> | null;
  const id = validLinkToken(body?.token)
    ? await openEvent(c.env.DB, c.get('userId'), body.token)
    : null;
  const event = id ? await findEvent(c.env, c.get('userId'), id) : null;
  return event
    ? c.json({ id: event.id, event })
    : c.json(
        {
          error: 'This event link isn’t available.',
        },
        404,
      );
});
events.post('/:id/response', bodyLimit({ maxSize: 1024 }), async (c) => {
  const body = (await json(c)) as Record<string, unknown> | null;
  const status = parseStatus(body?.status);
  if (!status)
    return c.json({ error: 'Choose Going, Maybe or Can’t go.' }, 400);
  return (await respond(c.env.DB, c.get('userId'), c.req.param('id'), status))
    ? c.json({ status })
    : c.json(
        {
          error:
            'Answers are closed for this event, or you need to open its link to answer.',
        },
        409,
      );
});
events.get('/:id/guests', async (c) => {
  const status = parseStatus(c.req.query('status'));
  if (!status) return c.json({ error: 'Invalid guest list.' }, 400);
  try {
    const cursor = parseCursor(c.req.query('cursor'));
    return c.json(
      await listGuests(
        c.env.DB,
        c.get('userId'),
        c.req.param('id'),
        status,
        cursor,
      ),
    );
  } catch {
    return c.json({ error: 'Invalid page.' }, 400);
  }
});
events.get('/:id/activity', async (c) => {
  try {
    const cursor = parseCursor(c.req.query('cursor'));
    return c.json(
      await eventLog(c.env.DB, c.get('userId'), c.req.param('id'), cursor),
    );
  } catch {
    return c.json({ error: 'Invalid page.' }, 400);
  }
});
events.post('/:id/messages', bodyLimit({ maxSize: 12000 }), async (c) => {
  const message = parseMessage(await json(c));
  if (!message)
    return c.json({ error: 'Write a message up to 2,000 characters.' }, 400);
  return (await postMessage(
    c.env.DB,
    c.get('userId'),
    c.req.param('id'),
    message.id,
    message.body,
  ))
    ? c.json({ id: message.id })
    : c.json(
        {
          error:
            'The message could not be posted. You can post up to 100 messages a day.',
        },
        409,
      );
});
events.delete('/:id/messages/:message', async (c) =>
  validId(c.req.param('message')) &&
  (await deleteMessage(
    c.env.DB,
    c.get('userId'),
    c.req.param('id'),
    c.req.param('message'),
  ))
    ? c.json({ ok: true })
    : c.json({ error: 'Message not found.' }, 404),
);
events.post('/:id/update-blasts', jsonLimit, async (c) => {
  const message = parseMessage(await json(c));
  if (!message)
    return c.json({ error: 'Write a message up to 2,000 characters.' }, 400);
  if (
    !(await sendUpdateBlast(
      c.env.DB,
      c.get('userId'),
      c.req.param('id'),
      message.id,
      message.body,
    ))
  )
    return c.json(
      {
        error: `The update blast could not be sent. Only hosts can send update blasts for an event that hasn’t been cancelled, up to ${UPDATE_BLASTS_PER_DAY} a day per event.`,
      },
      409,
    );
  return c.json({ id: message.id });
});
events.get('/:id/host-candidates', async (c) => {
  const query = (c.req.query('q') ?? '').trim();
  const after = c.req.query('after') ?? '';
  if (query.length > 60 || after.length > 30)
    return c.json({ error: 'Invalid search.' }, 400);
  return c.json(
    await hostCandidates(
      c.env.DB,
      c.get('userId'),
      c.req.param('id'),
      query,
      after,
    ),
  );
});
function memberId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
}
// Co-host invitations address an existing member, never an email address.
events.post('/:id/hosts', bodyLimit({ maxSize: 1024 }), async (c) => {
  const body = (await json(c)) as Record<string, unknown> | null;
  const userId = body?.userId;
  if (!memberId(userId)) return c.json({ error: 'Choose a member.' }, 400);
  return (await addHost(c.env.DB, c.get('userId'), c.req.param('id'), userId))
    ? c.json({ ok: true })
    : c.json(
        {
          error: `Choose a follower or someone you follow with a profile photo. Events allow up to ${MAX_EVENT_HOSTS} hosts including pending invitations, until they end or are cancelled.`,
        },
        409,
      );
});
events.delete('/:id/hosts', bodyLimit({ maxSize: 1024 }), async (c) => {
  const body = (await json(c)) as Record<string, unknown> | null;
  const userId = body?.userId;
  if (!memberId(userId)) return c.json({ error: 'Choose a member.' }, 400);
  return (await removePendingHost(
    c.env.DB,
    c.get('userId'),
    c.req.param('id'),
    userId,
  ))
    ? c.json({ ok: true })
    : c.json(notFound, 404);
});
events.delete('/:id/hosts/:handle', async (c) =>
  (await removeHost(
    c.env.DB,
    c.get('userId'),
    c.req.param('id'),
    c.req.param('handle'),
  ))
    ? c.json({ ok: true })
    : c.json(
        { error: 'This host couldn’t be removed. The creator always hosts.' },
        409,
      ),
);
// The invited member accepts or declines hosting.
events.post('/:id/hosting', async (c) =>
  (await acceptHosting(c.env.DB, c.get('userId'), c.req.param('id')))
    ? c.json({ ok: true })
    : c.json(
        {
          error:
            'This host invitation is no longer available. Ask a host to invite you again.',
        },
        409,
      ),
);
events.delete('/:id/hosting', async (c) => {
  await declineHosting(c.env.DB, c.get('userId'), c.req.param('id'));
  return c.json({ ok: true });
});

// Both app previews and crawler previews respect blocks for known members.
const previewSession: MiddlewareHandler<{
  Bindings: Env;
  Variables: { viewer: string | null };
}> = async (c, next) => {
  const session = authConfigured(c.env)
    ? await getActiveSession(c.env, c.req.raw.headers)
    : null;
  c.set('viewer', session?.user.id ?? null);
  await next();
};
eventLinks.use('*', previewSession);
eventShares.use('*', async (c, next) => {
  c.header('Referrer-Policy', 'no-referrer');
  c.header('X-Robots-Tag', 'noindex, nofollow');
  c.header('Cache-Control', 'private, no-store, no-transform');
  await previewSession(c, next);
});
eventShares.get('/:token', async (c) => {
  const token = c.req.param('token');
  const title = validLinkToken(token)
    ? await eventShareTitle(c.env.DB, token, c.get('viewer'))
    : null;
  if (title === null) return c.notFound();
  const shell = await c.env.ASSETS.fetch(
    new Request(new URL('/', c.env.APP_ORIGIN)),
  );
  if (!shell.ok) return c.text('Event preview is unavailable.', 503);
  const response = eventShareHtml(
    shell,
    title,
    `${c.env.APP_ORIGIN}/event/${token}`,
  );
  return c.newResponse(response.body, response);
});
eventShares.get('/:token/photo', async (c) => {
  const token = c.req.param('token');
  const key = validLinkToken(token)
    ? await eventPreviewMediaKey(c.env.DB, token, c.get('viewer'))
    : null;
  const response = key
    ? await privatePhoto(c.env, key, c.executionCtx, c.req.raw, 'no-store')
    : null;
  return response ? c.newResponse(response.body, response) : c.notFound();
});
eventShares.all('*', (c) => c.notFound());
const linkBodyLimit = bodyLimit({
  maxSize: 1024,
  onError: (c) => c.json({ error: 'Event link request is too large.' }, 413),
});
eventLinks.post('/', linkBodyLimit, async (c) => {
  const body = (await json(c)) as Record<string, unknown> | null;
  return c.json({
    event: validLinkToken(body?.token)
      ? await checkLink(c.env.DB, body.token, c.get('viewer'))
      : null,
  });
});
eventLinks.post('/photo', linkBodyLimit, async (c) => {
  const body = (await json(c)) as Record<string, unknown> | null;
  const key = validLinkToken(body?.token)
    ? await eventPreviewMediaKey(c.env.DB, body.token, c.get('viewer'))
    : null;
  const response = key
    ? await privatePhoto(c.env, key, c.executionCtx, c.req.raw, 'no-store')
    : null;
  return response ?? c.notFound();
});

// Covers load with the session; no credential or public URL is involved.
eventMedia.get('/:id', async (c) => {
  const size = c.req.query('size');
  if ((size !== undefined && size !== 'thumb') || !authConfigured(c.env))
    return c.notFound();
  const id = c.req.param('id');
  if (!validId(id)) return c.notFound();
  const key = (
    await readAsMember(c.env, c.req.raw.headers, (viewer) =>
      eventMediaKey(c.env.DB, viewer, id, size === 'thumb' ? 'thumb' : 'full'),
    )
  )?.value;
  // Cover replacement reuses this URL, so check every use.
  const response = key
    ? await privatePhoto(c.env, key, c.executionCtx, c.req.raw, 'revalidate')
    : null;
  return response ?? c.notFound();
});
