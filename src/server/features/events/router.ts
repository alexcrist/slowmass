import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { Env } from '../../env';
import { getActiveSession } from '../../auth';
import { authConfigured } from '../../auth/options';
import { PhotoError, privatePhoto } from '../../photos';
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
  findEvent,
  listEvents,
  listGuests,
  parseCursor,
  originalAppearance,
  parseAppearance,
  parseDetails,
  parseEmail,
  parseMessage,
  parseStatus,
  postMessage,
  openEvent,
  removeHost,
  removePendingHost,
  respond,
  saveEventPhoto,
  sendEventNotification,
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
  return id
    ? c.json({ id })
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
events.post('/:id/notifications', jsonLimit, async (c) => {
  const message = parseMessage(await json(c));
  if (!message)
    return c.json({ error: 'Write a message up to 2,000 characters.' }, 400);
  return (await sendEventNotification(
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
            'The notification could not be sent. Only hosts can send notifications for an event that hasn’t been cancelled, with up to 100 messages a day.',
        },
        409,
      );
});
// Pending hosts are emails, so they travel in request bodies, never URLs.
events.post('/:id/hosts', bodyLimit({ maxSize: 1024 }), async (c) => {
  const body = (await json(c)) as Record<string, unknown> | null;
  const email = parseEmail(body?.email);
  if (!email) return c.json({ error: 'Enter an email address.' }, 400);
  return (await addHost(c.env.DB, c.get('userId'), c.req.param('id'), email))
    ? c.json({ ok: true })
    : c.json(
        {
          error: `Hosts can be added until the event ends or is cancelled, up to ${MAX_EVENT_HOSTS} including pending ones.`,
        },
        409,
      );
});
events.delete('/:id/hosts', bodyLimit({ maxSize: 1024 }), async (c) => {
  const body = (await json(c)) as Record<string, unknown> | null;
  const email = parseEmail(body?.email);
  if (!email) return c.json({ error: 'Enter an email address.' }, 400);
  return (await removePendingHost(
    c.env.DB,
    c.get('userId'),
    c.req.param('id'),
    email,
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
// The member a host added by email accepts or declines hosting.
events.post('/:id/hosting', async (c) =>
  (await acceptHosting(c.env.DB, c.get('userId'), c.req.param('id')))
    ? c.json({ ok: true })
    : c.json(
        {
          error:
            'You can’t host this event. Add a profile photo, or ask a host to add the email you sign in with.',
        },
        409,
      ),
);
events.delete('/:id/hosting', async (c) => {
  await declineHosting(c.env.DB, c.get('userId'), c.req.param('id'));
  return c.json({ ok: true });
});

// Preview access requires the current link in a POST body, never a public
// media URL. For known members, preserve blocking on preview requests too.
eventLinks.use('*', async (c, next) => {
  const session = authConfigured(c.env)
    ? await getActiveSession(c.env, c.req.raw.headers)
    : null;
  c.set('viewer', session?.user.id ?? null);
  await next();
});
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
  const response = key ? await privatePhoto(c.env, key, c.executionCtx) : null;
  return response ?? c.notFound();
});

// Covers load with the session; no credential or public URL is involved.
eventMedia.get('/:id', async (c) => {
  const size = c.req.query('size');
  if ((size !== undefined && size !== 'thumb') || !authConfigured(c.env))
    return c.notFound();
  const session = await getActiveSession(c.env, c.req.raw.headers);
  const id = c.req.param('id');
  if (!session || !validId(id)) return c.notFound();
  const key = await eventMediaKey(
    c.env.DB,
    session.user.id,
    id,
    size === 'thumb' ? 'thumb' : 'full',
  );
  const response = key ? await privatePhoto(c.env, key, c.executionCtx) : null;
  return response ?? c.notFound();
});
