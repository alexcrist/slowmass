import { symmetricDecrypt, symmetricEncrypt } from 'better-auth/crypto';
import type { Env } from '../../env';
import type { EventAppearance } from '../../../shared/event-appearance';
export { parseAppearance } from '../../../shared/event-appearance';
import { PhotoError, processPhoto } from '../../photos';
import {
  readPhoto,
  releaseStorage,
  reservePhoto,
  reserveStorage,
} from '../../photos/storage';
import {
  EVENT_OVER_AFTER,
  eventAccess,
  eventResponse,
  invitationTokenHash,
  newInvitationCredential,
  normalizeEmail,
} from '../../membership';

const overAt = `COALESCE(e.ends_at,e.starts_at+${EVENT_OVER_AFTER})`;
const blocked = (a: string, b: string) =>
  `EXISTS(SELECT 1 FROM block WHERE (blocker_id=${a} AND target_id=${b}) OR (blocker_id=${b} AND target_id=${a}))`;
// Every read and write rechecks the creator, the viewer, blocks and publication.
const available = `e.state='published'
 AND EXISTS(SELECT 1 FROM membership c WHERE c.user_id=e.creator_id AND c.status='active')`;
const usable = `${available}
 AND EXISTS(SELECT 1 FROM membership vm WHERE vm.user_id=viewer.id AND vm.status='active')
 AND NOT ${blocked('viewer.id', 'e.creator_id')}`;
const hosting = `EXISTS(SELECT 1 FROM event_host WHERE event_id=e.id AND user_id=viewer.id)`;
const answered = `EXISTS(SELECT 1 FROM event_response WHERE event_id=e.id AND user_id=viewer.id)`;
const opened = `EXISTS(SELECT 1 FROM event_access a WHERE a.event_id=e.id AND a.user_id=viewer.id AND a.link_id=e.link_id)`;
// Opening the current link shows the event; answering (or hosting) also shows
// who else answered and the activity log, and outlasts a new link version.
const viewing = `${usable} AND (${hosting} OR ${answered} OR ${opened})`;
const participating = `${usable} AND (${hosting} OR ${answered})`;
const hostOf = `${usable} AND ${hosting}`;
// Hosts, including pending ones, per event; this bounds host fan-out.
export const MAX_EVENT_HOSTS = 10;
// Someone a host added by email may accept hosting the open event once they
// can view it, signed in with that email and a profile photo. Accepting is
// their consent to appear as a host to everyone with the link. Binds the
// current time.
const promotable = `e.cancelled_at IS NULL AND ${overAt}>?
 AND EXISTS(SELECT 1 FROM avatar WHERE user_id=viewer.id)
 AND EXISTS(SELECT 1 FROM event_host_invite i JOIN user u ON u.id=viewer.id AND i.email=lower(u.email)
   WHERE i.event_id=e.id)
 AND (SELECT COUNT(*) FROM event_host WHERE event_id=e.id)<${MAX_EVENT_HOSTS}`;

export type ResponseStatus = 'going' | 'maybe' | 'declined';
export const statuses: readonly ResponseStatus[] = [
  'going',
  'maybe',
  'declined',
];
export function parseStatus(value: unknown): ResponseStatus | null {
  return statuses.includes(value as ResponseStatus)
    ? (value as ResponseStatus)
    : null;
}
export function parseEmail(value: unknown) {
  if (typeof value !== 'string') return null;
  const email = normalizeEmail(value);
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ? email
    : null;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function validId(value: unknown): value is string {
  return typeof value === 'string' && uuid.test(value);
}
export function validLinkToken(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9]{48}$/.test(value);
}

export type EventDetails = {
  title: string;
  description: string;
  location: string;
  startsAt: number;
  endsAt: number | null;
  timeZone: string;
};
const earliest = Date.UTC(2000, 0, 1);
const latest = Date.UTC(2100, 0, 1);
function validTimeZone(zone: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}
export function parseDetails(value: unknown): EventDetails | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const { title, description, location, startsAt, endsAt, timeZone } = input;
  if (
    typeof title !== 'string' ||
    typeof description !== 'string' ||
    typeof location !== 'string' ||
    typeof timeZone !== 'string' ||
    !Number.isSafeInteger(startsAt) ||
    (endsAt !== null && !Number.isSafeInteger(endsAt))
  )
    return null;
  const start = startsAt as number;
  const end = endsAt as number | null;
  const details = {
    title: title.trim(),
    description: description.trim(),
    location: location.trim(),
    startsAt: start,
    endsAt: end,
    timeZone,
  };
  return details.title &&
    details.title.length <= 120 &&
    details.description.length <= 4000 &&
    details.location.length <= 300 &&
    timeZone.length <= 64 &&
    validTimeZone(timeZone) &&
    start >= earliest &&
    start < latest &&
    (end === null || (end > start && end <= start + 30 * 86400000))
    ? details
    : null;
}

export async function createEvent(
  env: Env,
  actor: string,
  id: string,
  details: EventDetails,
): Promise<'pending' | 'published' | 'conflict' | 'limit'> {
  const prior = await existingEvent(env.DB, id, actor, details);
  if (prior) return prior;
  const credential = await newInvitationCredential();
  const now = Date.now();
  // Creating, hosting and the creation allowance commit together; a retry with
  // the same ID and details converges on the first write.
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO event(id,creator_id,title,description,location,starts_at,ends_at,time_zone,link_id,link_hash,link_encrypted,created_at)
      SELECT ?,m.user_id,?,?,?,?,?,?,?,?,?,? FROM membership m JOIN avatar a ON a.user_id=m.user_id
      WHERE m.user_id=? AND m.status='active'
        AND (SELECT COUNT(*) FROM event WHERE creator_id=m.user_id AND created_at>?)<10
      ON CONFLICT DO NOTHING`,
    ).bind(
      id,
      details.title,
      details.description,
      details.location,
      details.startsAt,
      details.endsAt,
      details.timeZone,
      crypto.randomUUID(),
      credential.hash,
      await symmetricEncrypt({ key: env.AUTH_SECRET!, data: credential.token }),
      now,
      actor,
      now - 86400000,
    ),
    env.DB.prepare(
      `INSERT INTO event_host(event_id,user_id,created_at)
      SELECT id,creator_id,created_at FROM event WHERE id=? AND creator_id=? AND state='pending'
      ON CONFLICT DO NOTHING`,
    ).bind(id, actor),
  ]);
  return (await existingEvent(env.DB, id, actor, details)) ?? 'limit';
}
async function existingEvent(
  db: D1Database,
  id: string,
  actor: string,
  details: EventDetails,
) {
  const row = await db
    .prepare(
      `SELECT creator_id AS creator,state,title,description,location,starts_at AS startsAt,
      ends_at AS endsAt,time_zone AS timeZone FROM event WHERE id=?`,
    )
    .bind(id)
    .first<EventDetails & { creator: string; state: string }>();
  if (!row) return null;
  return row.creator === actor &&
    row.state !== 'deleted' &&
    row.title === details.title &&
    row.description === details.description &&
    row.location === details.location &&
    row.startsAt === details.startsAt &&
    row.endsAt === details.endsAt &&
    row.timeZone === details.timeZone
    ? (row.state as 'pending' | 'published')
    : 'conflict';
}

// Hosts upload a cover photo for a pending event or replace a published one.
export async function saveEventPhoto(
  env: Env,
  actor: string,
  id: string,
  upload: string,
  request: Request,
) {
  if (!env.IMAGES)
    throw new PhotoError('Photo processing is unavailable.', 503);
  const host = await env.DB.prepare(
    `WITH viewer AS (SELECT ? AS id) SELECT e.id FROM event e CROSS JOIN viewer
    WHERE e.id=? AND e.state IN ('pending','published') AND e.cancelled_at IS NULL
      AND EXISTS(SELECT 1 FROM membership vm WHERE vm.user_id=viewer.id AND vm.status='active')
      AND ${hosting}`,
  )
    .bind(actor, id)
    .first();
  if (!host) return 'missing';
  const state = await reservePhoto(env.DB, actor, `event/${upload}`, 2);
  if (state !== 'reserved') return state;
  try {
    const photo = await processPhoto(env.IMAGES, await readPhoto(request));
    const thumbnail =
      photo.width <= 480 && photo.height <= 480
        ? photo
        : await processPhoto(env.IMAGES, photo.bytes, 480);
    const key = `events/${crypto.randomUUID()}.webp`;
    const thumbnailKey =
      thumbnail === photo ? key : `events/${crypto.randomUUID()}.webp`;
    // Each storage reservation records cleanup intent before R2 receives bytes.
    await reserveStorage(env.DB, actor, key, photo.bytes.length);
    await env.PHOTOS.put(key, photo.bytes, {
      httpMetadata: { contentType: 'image/webp' },
    });
    if (thumbnailKey !== key) {
      await reserveStorage(env.DB, actor, thumbnailKey, thumbnail.bytes.length);
      await env.PHOTOS.put(thumbnailKey, thumbnail.bytes, {
        httpMetadata: { contentType: 'image/webp' },
      });
    }
    const now = Date.now();
    const saved = await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO photo_cleanup(object_key,not_before) SELECT object_key,? FROM event
        WHERE id=? AND object_key IS NOT NULL ON CONFLICT DO NOTHING`,
      ).bind(now, id),
      env.DB.prepare(
        `INSERT INTO photo_cleanup(object_key,not_before) SELECT thumbnail_key,? FROM event
        WHERE id=? AND thumbnail_key IS NOT NULL ON CONFLICT DO NOTHING`,
      ).bind(now, id),
      env.DB.prepare(
        `UPDATE event SET state='published',object_key=?,thumbnail_key=?,width=?,height=?
        WHERE id=? AND state IN ('pending','published') AND cancelled_at IS NULL
          AND EXISTS(SELECT 1 FROM event_host h JOIN membership m ON m.user_id=h.user_id AND m.status='active'
            WHERE h.event_id=event.id AND h.user_id=?)`,
      ).bind(key, thumbnailKey, photo.width, photo.height, id, actor),
      env.DB.prepare(
        "UPDATE photo_attempt SET state=CASE WHEN EXISTS(SELECT 1 FROM event WHERE id=? AND object_key=?) THEN 'done' ELSE 'failed' END WHERE id=?",
      ).bind(id, key, `${actor}:event/${upload}`),
      env.DB.prepare(
        'DELETE FROM photo_cleanup WHERE object_key IN (?,?) AND EXISTS(SELECT 1 FROM event WHERE id=? AND object_key=? AND thumbnail_key=?)',
      ).bind(key, thumbnailKey, id, key, thumbnailKey),
    ]);
    return saved[2].meta.changes ? 'done' : 'missing';
  } catch (error) {
    await env.DB.prepare(
      "UPDATE photo_attempt SET state='failed' WHERE id=? AND state='pending'",
    )
      .bind(`${actor}:event/${upload}`)
      .run();
    throw error;
  }
}

type EventRow = EventDetails &
  EventAppearance & {
    id: string;
    cancelledAt: number | null;
    width: number;
    height: number;
  };
const detailColumns = `e.id,e.title,e.description,e.location,e.starts_at AS startsAt,
 e.ends_at AS endsAt,e.time_zone AS timeZone,e.cancelled_at AS cancelledAt,e.width,e.height,
 e.color_theme AS colorTheme,e.font_pairing AS fontPairing`;
function publicDetails(row: EventRow) {
  const { cancelledAt, colorTheme, fontPairing, ...details } = row;
  return {
    ...details,
    appearance: { colorTheme, fontPairing },
    cancelled: cancelledAt !== null,
    over: (row.endsAt ?? row.startsAt + EVENT_OVER_AFTER) <= Date.now(),
    photoUrl: `/media/events/${row.id}`,
    thumbnailUrl: `/media/events/${row.id}?size=thumb`,
  };
}
type Host = {
  handle: string;
  displayName: string;
  hasAvatar: boolean;
  // The creator always stays a host; other hosts can be removed or leave.
  isCreator: boolean;
  isViewer: boolean;
};
type Flag = 'hasAvatar' | 'isCreator' | 'isViewer';
async function hosts(db: D1Database, id: string, viewer: string) {
  const rows = await db
    .prepare(
      `WITH viewer AS (SELECT ? AS id) SELECT p.handle,p.display_name AS displayName,
      EXISTS(SELECT 1 FROM avatar a WHERE a.user_id=h.user_id) AS hasAvatar,
      h.user_id=(SELECT creator_id FROM event WHERE id=h.event_id) AS isCreator,
      h.user_id=viewer.id AS isViewer
      FROM event_host h CROSS JOIN viewer JOIN profile p ON p.user_id=h.user_id
      JOIN membership m ON m.user_id=h.user_id AND m.status='active'
      WHERE h.event_id=? AND NOT ${blocked('viewer.id', 'h.user_id')}
      ORDER BY h.created_at,h.user_id LIMIT ${MAX_EVENT_HOSTS}`,
    )
    .bind(viewer, id)
    .all<Omit<Host, Flag> & Record<Flag, number>>();
  return rows.results.map((row) => ({
    ...row,
    hasAvatar: Boolean(row.hasAvatar),
    isCreator: Boolean(row.isCreator),
    isViewer: Boolean(row.isViewer),
  }));
}
async function pendingHosts(db: D1Database, id: string, viewer: string) {
  const rows = await db
    .prepare(
      `WITH viewer AS (SELECT ? AS id) SELECT i.email FROM event e CROSS JOIN viewer
      JOIN event_host_invite i ON i.event_id=e.id WHERE e.id=? AND ${hostOf}
      ORDER BY i.created_at,i.email LIMIT ${MAX_EVENT_HOSTS}`,
    )
    .bind(viewer, id)
    .all<{ email: string }>();
  return rows.results.map((row) => row.email);
}
const visibleResponder = `JOIN membership rm ON rm.user_id=r.user_id AND rm.status='active'
 JOIN profile rp ON rp.user_id=r.user_id`;

async function readEvent(db: D1Database, viewer: string, id: string) {
  return db
    .prepare(
      `WITH viewer AS (SELECT ? AS id) SELECT ${detailColumns},
      ${hosting} AS isHost,e.creator_id=viewer.id AS isCreator,
      NOT ${hosting} AND ${promotable} AS hostInvited,
      (SELECT status FROM event_response WHERE event_id=e.id AND user_id=viewer.id) AS response,
      e.link_encrypted AS link,
      ${statuses
        .map(
          (
            status,
          ) => `CASE WHEN ${hosting} OR ${answered} THEN (SELECT COUNT(*) FROM event_response r ${visibleResponder}
        WHERE r.event_id=e.id AND r.status='${status}' AND NOT ${blocked('viewer.id', 'r.user_id')}) END AS ${status}`,
        )
        .join(',')}
      FROM event e CROSS JOIN viewer WHERE e.id=? AND ${viewing}`,
    )
    .bind(viewer, Date.now(), id)
    .first<
      EventRow & {
        isHost: number;
        isCreator: number;
        hostInvited: number;
        response: ResponseStatus | null;
        link: string | null;
      } & Record<ResponseStatus, number | null>
    >();
}
// Accepting is retry-safe: the pending email goes once its owner is a host.
export async function acceptHosting(
  db: D1Database,
  viewer: string,
  id: string,
) {
  const now = Date.now();
  const [, , host] = await db.batch([
    db
      .prepare(
        `WITH viewer AS (SELECT ? AS id) INSERT INTO event_host(event_id,user_id,created_at)
        SELECT e.id,viewer.id,? FROM event e CROSS JOIN viewer
        WHERE e.id=? AND ${viewing} AND ${promotable}
        ON CONFLICT DO NOTHING`,
      )
      .bind(viewer, now, id, now),
    db
      .prepare(
        `DELETE FROM event_host_invite WHERE event_id=? AND email=(SELECT lower(email) FROM user WHERE id=?)
        AND EXISTS(SELECT 1 FROM event_host WHERE event_id=? AND user_id=?)`,
      )
      .bind(id, viewer, id, viewer),
    db
      .prepare(
        `WITH viewer AS (SELECT ? AS id) SELECT 1 AS host FROM event e CROSS JOIN viewer
        WHERE e.id=? AND ${hostOf}`,
      )
      .bind(viewer, id),
  ]);
  return host.results.length > 0;
}
// Declining removes the invitation to the member's own email.
export async function declineHosting(
  db: D1Database,
  viewer: string,
  id: string,
) {
  await db
    .prepare(
      'DELETE FROM event_host_invite WHERE event_id=? AND email=(SELECT lower(email) FROM user WHERE id=?)',
    )
    .bind(id, viewer)
    .run();
}

export async function findEvent(env: Env, viewer: string, id: string) {
  const row = await readEvent(env.DB, viewer, id);
  if (!row) return null;
  const {
    isHost,
    isCreator,
    hostInvited,
    response,
    link,
    going,
    maybe,
    declined,
    ...event
  } = row;
  return {
    ...publicDetails(event),
    hosts: await hosts(env.DB, id, viewer),
    // Emails hosts added that are not hosts yet, shown only to hosts.
    pendingHosts: isHost ? await pendingHosts(env.DB, id, viewer) : [],
    // Only hosts and people who answered see how others answered.
    counts:
      going === null || maybe === null || declined === null
        ? null
        : { going, maybe, declined },
    // Everyone who can see the event can share its one URL. There is none when
    // the credential cannot be recovered (after a restore quarantine).
    url: await linkUrl(env, link),
    viewer: {
      isHost: Boolean(isHost),
      isCreator: Boolean(isCreator),
      // A host added this member's email; they can accept or decline.
      hostInvited: Boolean(hostInvited),
      response,
    },
  };
}

// Any host adds someone by email. The reply is the same whether or not an
// account uses the address; adding it again succeeds.
export async function addHost(
  db: D1Database,
  actor: string,
  id: string,
  email: string,
) {
  const now = Date.now();
  await db
    .prepare(
      `WITH viewer AS (SELECT ? AS id) INSERT INTO event_host_invite(event_id,email,created_at)
      SELECT e.id,?,? FROM event e CROSS JOIN viewer
      WHERE e.id=? AND ${hostOf} AND e.cancelled_at IS NULL AND ${overAt}>?
        AND (SELECT COUNT(*) FROM event_host WHERE event_id=e.id)
          +(SELECT COUNT(*) FROM event_host_invite WHERE event_id=e.id)<${MAX_EVENT_HOSTS}
      ON CONFLICT DO NOTHING`,
    )
    .bind(actor, email, now, id, now)
    .run();
  return Boolean(
    await db
      .prepare(
        `WITH viewer AS (SELECT ? AS id) SELECT 1 FROM event e CROSS JOIN viewer
        JOIN event_host_invite i ON i.event_id=e.id AND i.email=?
        WHERE e.id=? AND ${hostOf}`,
      )
      .bind(actor, email, id)
      .first(),
  );
}
// Removing a pending email twice is a successful no-op for hosts.
export async function removePendingHost(
  db: D1Database,
  actor: string,
  id: string,
  email: string,
) {
  const [, host] = await db.batch([
    db
      .prepare(
        `WITH viewer AS (SELECT ? AS id) DELETE FROM event_host_invite WHERE event_id=? AND email=?
        AND EXISTS(SELECT 1 FROM event e CROSS JOIN viewer WHERE e.id=event_host_invite.event_id AND ${hostOf})`,
      )
      .bind(actor, id, email),
    db
      .prepare(
        `WITH viewer AS (SELECT ? AS id) SELECT 1 AS host FROM event e CROSS JOIN viewer
        WHERE e.id=? AND ${hostOf}`,
      )
      .bind(actor, id),
  ]);
  return host.results.length > 0;
}
// Any host removes another host except the creator; hosts can also leave.
// Succeeds once that person no longer hosts, so retries converge.
export async function removeHost(
  db: D1Database,
  actor: string,
  id: string,
  handle: string,
) {
  const target = `(SELECT user_id FROM profile WHERE handle=?)`;
  const [, removed] = await db.batch([
    db
      .prepare(
        `WITH viewer AS (SELECT ? AS id) DELETE FROM event_host WHERE event_id=? AND user_id=${target}
        AND EXISTS(SELECT 1 FROM event e CROSS JOIN viewer WHERE e.id=event_host.event_id
          AND e.creator_id!=event_host.user_id AND (${hostOf} OR viewer.id=event_host.user_id))`,
      )
      .bind(actor, id, handle),
    db
      .prepare(
        `WITH viewer AS (SELECT ? AS id) SELECT 1 AS removed FROM viewer
        WHERE NOT EXISTS(SELECT 1 FROM event_host WHERE event_id=? AND user_id=${target})
          AND (viewer.id=${target}
            OR EXISTS(SELECT 1 FROM event e WHERE e.id=? AND ${hostOf}))`,
      )
      .bind(actor, id, handle, handle, id),
  ]);
  return removed.results.length > 0;
}

// A link authorizes only the preview before sign-in. Never select private
// details here. Known members still respect blocks with the creator.
const previewable = `${available} AND (? IS NULL OR NOT ${blocked('?', 'e.creator_id')})`;
export async function checkLink(
  db: D1Database,
  token: string,
  viewer: string | null = null,
) {
  const row = await db
    .prepare(
      `SELECT e.id,e.title,e.starts_at AS startsAt,e.time_zone AS timeZone,e.width,e.height,
      e.color_theme AS colorTheme,e.font_pairing AS fontPairing,
      e.cancelled_at IS NULL AND ${overAt}>?
        AND EXISTS(SELECT 1 FROM avatar WHERE user_id=e.creator_id) AS open FROM event e
      WHERE e.link_hash=? AND ${previewable}`,
    )
    .bind(Date.now(), await invitationTokenHash(token), viewer, viewer, viewer)
    .first<
      EventAppearance & {
        id: string;
        title: string;
        startsAt: number;
        timeZone: string;
        width: number;
        height: number;
        open: number;
      }
    >();
  return row
    ? {
        id: row.id,
        open: Boolean(row.open),
        preview: {
          appearance: {
            colorTheme: row.colorTheme,
            fontPairing: row.fontPairing,
          },
          title: row.title,
          date: new Intl.DateTimeFormat('en-US', {
            timeZone: row.timeZone,
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          }).format(row.startsAt),
          width: row.width,
          height: row.height,
        },
      }
    : null;
}

// Fetch the already processed cover thumbnail, rechecking the current link
// even when its immutable bytes are warm in the internal image cache.
export async function eventPreviewMediaKey(
  db: D1Database,
  token: string,
  viewer: string | null = null,
) {
  const row = await db
    .prepare(
      `SELECT e.thumbnail_key AS key FROM event e
    WHERE e.link_hash=? AND ${previewable}`,
    )
    .bind(await invitationTokenHash(token), viewer, viewer, viewer)
    .first<{ key: string }>();
  return row?.key ?? null;
}

// Opening the current link records the version for this member and returns
// the event to show.
export async function openEvent(db: D1Database, viewer: string, token: string) {
  await eventAccess(db, viewer, {
    linkHash: await invitationTokenHash(token),
  }).run();
  const row = await db
    .prepare(
      `WITH viewer AS (SELECT ? AS id) SELECT e.id FROM event e CROSS JOIN viewer
      WHERE e.link_hash=? AND ${viewing}`,
    )
    .bind(viewer, await invitationTokenHash(token))
    .first<{ id: string }>();
  return row?.id ?? null;
}

// Covers load with the session after the same access checks as a read.
export async function eventMediaKey(
  db: D1Database,
  viewer: string,
  id: string,
  size: 'full' | 'thumb',
) {
  const row = await db
    .prepare(
      `WITH viewer AS (SELECT ? AS id) SELECT e.object_key AS full,e.thumbnail_key AS thumb
      FROM event e CROSS JOIN viewer WHERE e.id=? AND ${viewing}`,
    )
    .bind(viewer, id)
    .first<{ full: string; thumb: string }>();
  return row?.[size] ?? null;
}

export async function respond(
  db: D1Database,
  actor: string,
  id: string,
  status: ResponseStatus,
) {
  const result = await eventResponse(db, actor, id, status).run();
  return result.meta.changes > 0;
}

type Person = {
  handle: string;
  displayName: string;
  hasAvatar: boolean;
};
const person = (user: string) => `rp.handle,rp.display_name AS displayName,
 EXISTS(SELECT 1 FROM avatar WHERE user_id=${user}) AS hasAvatar`;
type Cursor = { time: number; key: string };
export function parseCursor(value: string | undefined): Cursor | null {
  if (!value) return null;
  if (value.length > 400) throw new Error('Invalid page.');
  try {
    const cursor = JSON.parse(atob(value)) as Cursor;
    if (
      !Number.isSafeInteger(cursor.time) ||
      cursor.time < 0 ||
      typeof cursor.key !== 'string' ||
      cursor.key.length > 100
    )
      throw new Error();
    return { time: cursor.time, key: cursor.key };
  } catch {
    throw new Error('Invalid page.');
  }
}
const encodeCursor = (cursor: Cursor) => btoa(JSON.stringify(cursor));

export async function listGuests(
  db: D1Database,
  viewer: string,
  id: string,
  status: ResponseStatus,
  cursor: Cursor | null,
) {
  const rows = await db
    .prepare(
      `WITH viewer AS (SELECT ? AS id) SELECT ${person('r.user_id')},r.updated_at AS time,r.user_id AS key
      FROM event e CROSS JOIN viewer JOIN event_response r ON r.event_id=e.id ${visibleResponder}
      WHERE e.id=? AND ${participating} AND r.status=?
        AND (r.updated_at,r.user_id)<(?,?) AND NOT ${blocked('viewer.id', 'r.user_id')}
      ORDER BY r.updated_at DESC,r.user_id DESC LIMIT 31`,
    )
    .bind(
      viewer,
      id,
      status,
      cursor?.time ?? Number.MAX_SAFE_INTEGER,
      cursor?.key ?? '',
    )
    .all<Omit<Person, 'hasAvatar'> & Cursor & { hasAvatar: number }>();
  const items = rows.results.slice(0, 30);
  const last = items.at(-1);
  return {
    items: items.map(({ time, key, hasAvatar, ...person }) => {
      void time;
      void key;
      return { ...person, hasAvatar: Boolean(hasAvatar) };
    }),
    next:
      rows.results.length > 30 && last
        ? encodeCursor({ time: last.time, key: last.key })
        : null,
  };
}

// Answers (latest per guest) and messages, newest first. Each side reads at
// most one page through its own index before the merge.
export async function eventLog(
  db: D1Database,
  viewer: string,
  id: string,
  cursor: Cursor | null,
) {
  const time = cursor?.time ?? Number.MAX_SAFE_INTEGER;
  const key = cursor?.key ?? '';
  const rows = await db
    .prepare(
      `WITH viewer AS (SELECT ? AS id), allowed AS MATERIALIZED (
        SELECT e.id FROM event e CROSS JOIN viewer WHERE e.id=? AND ${participating}
      ), answers AS MATERIALIZED (
        SELECT 'response' AS kind,NULL AS id,r.status AS status,'' AS body,r.updated_at AS time,
          'r:'||r.user_id AS key,${person('r.user_id')},0 AS canDelete
        FROM allowed CROSS JOIN event_response r ON r.event_id=allowed.id CROSS JOIN viewer ${visibleResponder}
        WHERE (r.updated_at,'r:'||r.user_id)<(?,?) AND NOT ${blocked('viewer.id', 'r.user_id')}
        ORDER BY r.updated_at DESC,r.user_id DESC LIMIT 21
      ), messages AS MATERIALIZED (
        SELECT m.kind,m.id,NULL AS status,m.body,m.created_at AS time,'m:'||m.id AS key,
          ${person('m.user_id')},
          m.kind='message' AND (m.user_id=viewer.id OR EXISTS(SELECT 1 FROM event_host WHERE event_id=m.event_id AND user_id=viewer.id)) AS canDelete
        FROM allowed CROSS JOIN event_message m ON m.event_id=allowed.id CROSS JOIN viewer
        JOIN membership rm ON rm.user_id=m.user_id AND rm.status='active'
        JOIN profile rp ON rp.user_id=m.user_id
        WHERE m.deleted_at IS NULL AND m.kind!='changed' AND (m.created_at,'m:'||m.id)<(?,?)
          AND NOT ${blocked('viewer.id', 'm.user_id')}
        ORDER BY m.created_at DESC,m.id DESC LIMIT 21
      ) SELECT * FROM (SELECT * FROM answers UNION ALL SELECT * FROM messages)
      ORDER BY time DESC,key DESC LIMIT 21`,
    )
    .bind(viewer, id, time, key, time, key)
    .all<
      {
        kind: 'response' | 'message' | 'cancelled';
        id: string | null;
        status: ResponseStatus | null;
        body: string;
        time: number;
        key: string;
        hasAvatar: number;
        canDelete: number;
      } & Omit<Person, 'hasAvatar'>
    >();
  const items = rows.results.slice(0, 20);
  const last = items.at(-1);
  return {
    items: items.map(({ key, time, hasAvatar, canDelete, ...item }) => ({
      ...item,
      key,
      createdAt: time,
      hasAvatar: Boolean(hasAvatar),
      canDelete: Boolean(canDelete),
    })),
    next:
      rows.results.length > 20 && last
        ? encodeCursor({ time: last.time, key: last.key })
        : null,
  };
}

export function parseMessage(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { id, body } = value as Record<string, unknown>;
  if (!validId(id) || typeof body !== 'string') return null;
  const text = body.trim();
  return text && text.length <= 2000 ? { id, body: text } : null;
}
export async function postMessage(
  db: D1Database,
  actor: string,
  event: string,
  id: string,
  body: string,
) {
  return writeMessage(db, actor, event, id, body, 'participant');
}

// An explicit host blast is a host message, sharing the same atomic Activity
// fan-out, push queue, deletion rules and daily allowance.
export async function sendEventNotification(
  db: D1Database,
  actor: string,
  event: string,
  id: string,
  body: string,
) {
  return writeMessage(db, actor, event, id, body, 'host');
}

async function writeMessage(
  db: D1Database,
  actor: string,
  event: string,
  id: string,
  body: string,
  access: 'participant' | 'host',
) {
  const allowed =
    access === 'host' ? `${hostOf} AND e.cancelled_at IS NULL` : participating;
  const now = Date.now();
  await db
    .prepare(
      `WITH viewer AS (SELECT ? AS id)
      INSERT INTO event_message(id,event_id,user_id,kind,body,created_at)
      SELECT ?,e.id,viewer.id,'message',?,? FROM event e CROSS JOIN viewer
      WHERE e.id=? AND ${allowed}
        AND (SELECT COUNT(*) FROM event_message WHERE user_id=viewer.id AND created_at>?)<100
      ON CONFLICT DO NOTHING`,
    )
    .bind(actor, id, body, now, event, now - 86400000)
    .run();
  // A retried request succeeds only for the same author, event and text.
  return Boolean(
    await db
      .prepare(
        `WITH viewer AS (SELECT ? AS id)
        SELECT 1 FROM event_message m JOIN event e ON e.id=m.event_id CROSS JOIN viewer
        WHERE m.id=? AND e.id=? AND m.user_id=viewer.id AND m.kind='message'
          AND m.body=? AND m.deleted_at IS NULL AND ${allowed}`,
      )
      .bind(actor, id, event, body)
      .first(),
  );
}
// Authors and hosts can remove ordinary messages.
export async function deleteMessage(
  db: D1Database,
  actor: string,
  event: string,
  id: string,
) {
  const result = await db
    .prepare(
      `UPDATE event_message SET body='',deleted_at=COALESCE(deleted_at,?)
      WHERE id=? AND event_id=? AND kind='message' AND (user_id=? OR EXISTS(
        SELECT 1 FROM event_host h JOIN membership m ON m.user_id=h.user_id AND m.status='active'
        WHERE h.event_id=event_message.event_id AND h.user_id=?))`,
    )
    .bind(Date.now(), id, event, actor, actor)
    .run();
  return Boolean(result.meta.changes);
}

// Compare the host's last read in the write itself. Identical retries succeed,
// but an old draft cannot overwrite another host's different saved appearance.
// This touches no event details and creates no activity or push work.
export async function updateAppearance(
  db: D1Database,
  actor: string,
  id: string,
  appearance: EventAppearance,
  expected: EventAppearance,
) {
  const result = await db
    .prepare(
      `WITH viewer AS (SELECT ? AS id)
    UPDATE event SET color_theme=?,font_pairing=?
    WHERE id=? AND cancelled_at IS NULL
      AND ((color_theme=? AND font_pairing=?) OR (color_theme=? AND font_pairing=?))
      AND EXISTS(SELECT 1 FROM event e CROSS JOIN viewer WHERE e.id=event.id AND ${hostOf})`,
    )
    .bind(
      actor,
      appearance.colorTheme,
      appearance.fontPairing,
      id,
      expected.colorTheme,
      expected.fontPairing,
      appearance.colorTheme,
      appearance.fontPairing,
    )
    .run();
  return result.meta.changes > 0;
}

// Detail edits are silent. Hosts send notifications explicitly.
export async function updateEvent(
  db: D1Database,
  actor: string,
  id: string,
  details: EventDetails,
) {
  const current = await db
    .prepare(
      `WITH viewer AS (SELECT ? AS id) SELECT ${detailColumns} FROM event e CROSS JOIN viewer
      WHERE e.id=? AND ${hostOf} AND e.cancelled_at IS NULL`,
    )
    .bind(actor, id)
    .first<EventRow>();
  if (!current) return false;
  const result = await db
    .prepare(
      `WITH viewer AS (SELECT ? AS id)
        UPDATE event SET title=?,description=?,location=?,starts_at=?,ends_at=?,time_zone=?
        WHERE id=? AND state='published' AND cancelled_at IS NULL
          AND starts_at=? AND ends_at IS ? AND time_zone=? AND location=?
          AND title=? AND description=?
          AND EXISTS(SELECT 1 FROM event e CROSS JOIN viewer WHERE e.id=event.id AND ${hostOf})`,
    )
    .bind(
      actor,
      details.title,
      details.description,
      details.location,
      details.startsAt,
      details.endsAt,
      details.timeZone,
      id,
      current.startsAt,
      current.endsAt,
      current.timeZone,
      current.location,
      current.title,
      current.description,
    )
    .run();
  return result.meta.changes > 0;
}
export async function cancelEvent(
  db: D1Database,
  actor: string,
  id: string,
  messageId: string,
) {
  await db.batch([
    db
      .prepare(
        `UPDATE event SET cancelled_at=? WHERE id=? AND state='published' AND cancelled_at IS NULL
        AND EXISTS(SELECT 1 FROM event_host h JOIN membership m ON m.user_id=h.user_id AND m.status='active'
          WHERE h.event_id=event.id AND h.user_id=?)`,
      )
      .bind(Date.now(), id, actor),
    db
      .prepare(
        `INSERT INTO event_message(id,event_id,user_id,kind,created_at)
        SELECT ?,?,?,'cancelled',? WHERE changes()=1 ON CONFLICT DO NOTHING`,
      )
      .bind(messageId, id, actor, Date.now()),
  ]);
  // Cancelling twice is a successful no-op.
  return Boolean(
    await db
      .prepare(
        `WITH viewer AS (SELECT ? AS id) SELECT 1 FROM event e CROSS JOIN viewer
        WHERE e.id=? AND ${hostOf} AND e.cancelled_at IS NOT NULL`,
      )
      .bind(actor, id)
      .first(),
  );
}

export async function listEvents(
  db: D1Database,
  viewer: string,
  when: 'upcoming' | 'past',
  cursor: Cursor | null,
) {
  const now = Date.now();
  const upcoming = when === 'upcoming';
  const rows = await db
    .prepare(
      `WITH viewer AS (SELECT ? AS id), mine AS MATERIALIZED (
        SELECT h.event_id FROM viewer CROSS JOIN event_host h ON h.user_id=viewer.id
        UNION SELECT r.event_id FROM viewer CROSS JOIN event_response r ON r.user_id=viewer.id
        UNION SELECT a.event_id FROM viewer CROSS JOIN event_access a ON a.user_id=viewer.id
      ) SELECT ${detailColumns},${hosting} AS isHost,
        (SELECT status FROM event_response WHERE event_id=e.id AND user_id=viewer.id) AS response
      FROM mine CROSS JOIN event e ON e.id=mine.event_id CROSS JOIN viewer
      WHERE ${viewing} AND ${overAt}${upcoming ? '>' : '<='}?
        AND (e.starts_at,e.id)${upcoming ? '>' : '<'}(?,?)
      ORDER BY e.starts_at ${upcoming ? 'ASC' : 'DESC'},e.id ${upcoming ? 'ASC' : 'DESC'} LIMIT 21`,
    )
    .bind(
      viewer,
      now,
      cursor?.time ??
        (upcoming ? Number.MIN_SAFE_INTEGER : Number.MAX_SAFE_INTEGER),
      cursor?.key ?? '',
    )
    .all<EventRow & { isHost: number; response: ResponseStatus | null }>();
  const items = rows.results.slice(0, 20);
  const last = items.at(-1);
  return {
    items: items.map(({ isHost, response, ...event }) => ({
      ...publicDetails(event),
      isHost: Boolean(isHost),
      response,
    })),
    next:
      rows.results.length > 20 && last
        ? encodeCursor({ time: last.startsAt, key: last.id })
        : null,
  };
}

// The event's one URL. The credential stays in the fragment, so it never
// reaches server logs or referrers.
async function linkUrl(env: Env, encrypted: string | null) {
  if (!encrypted) return null;
  try {
    const token = await symmetricDecrypt({
      key: env.AUTH_SECRET!,
      data: encrypted,
    });
    return `${env.APP_ORIGIN}/#event/${token}`;
  } catch {
    return null;
  }
}
export async function cleanupEvents(db: D1Database, bucket: R2Bucket) {
  const now = Date.now();
  const due = await db
    .prepare(
      "SELECT object_key FROM photo_cleanup WHERE object_key LIKE 'events/%' AND not_before<=? ORDER BY not_before LIMIT 2",
    )
    .bind(now)
    .all<{ object_key: string }>();
  for (const row of due.results) {
    if (
      await db
        .prepare('SELECT 1 FROM event WHERE object_key=? OR thumbnail_key=?')
        .bind(row.object_key, row.object_key)
        .first()
    )
      continue;
    try {
      await bucket.delete(row.object_key);
      await releaseStorage(db, row.object_key);
      await db
        .prepare('DELETE FROM photo_cleanup WHERE object_key=?')
        .bind(row.object_key)
        .run();
    } catch {
      /* Retry on next scheduled pass. */
    }
  }
  // Drafts whose photo never arrived stop holding a link after a day, and
  // pending host emails go once their event has ended.
  await db.batch([
    db
      .prepare(
        "UPDATE event SET state='deleted',link_encrypted=NULL WHERE id IN(SELECT id FROM event WHERE state='pending' AND created_at<? LIMIT 50)",
      )
      .bind(now - 86400000),
    db
      .prepare(
        'DELETE FROM event_claim WHERE token_hash IN(SELECT token_hash FROM event_claim WHERE expires_at<=? LIMIT 100)',
      )
      .bind(now),
    db
      .prepare(
        `DELETE FROM event_host_invite WHERE rowid IN(SELECT i.rowid FROM event_host_invite i
        JOIN event e ON e.id=i.event_id
        WHERE e.state!='published' OR e.cancelled_at IS NOT NULL OR ${overAt}<=? LIMIT 100)`,
      )
      .bind(now),
  ]);
}
