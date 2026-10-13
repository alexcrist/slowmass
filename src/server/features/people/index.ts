export type ProfileInput = { handle: string; displayName: string; bio: string };
export function parseProfile(value: unknown): ProfileInput | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  if (
    typeof input.handle !== 'string' ||
    typeof input.displayName !== 'string' ||
    typeof input.bio !== 'string'
  )
    return null;
  const handle = input.handle.trim().toLowerCase();
  const displayName = input.displayName.trim();
  const bio = input.bio.trim();
  if (
    !/^[a-z0-9_]{3,30}$/.test(handle) ||
    !displayName ||
    displayName.length > 60 ||
    bio.length > 500
  )
    return null;
  return { handle, displayName, bio };
}

export async function ownProfile(db: D1Database, id: string) {
  return db
    .prepare(
      'SELECT handle, display_name AS displayName, bio, EXISTS(SELECT 1 FROM avatar WHERE avatar.user_id=profile.user_id) AS hasAvatar FROM profile WHERE user_id = ?',
    )
    .bind(id)
    .first<ProfileInput & { hasAvatar: number }>();
}

export async function saveProfile(
  db: D1Database,
  id: string,
  input: ProfileInput,
) {
  // These names are literal API routes, not member profile addresses.
  if (['self', 'discover', 'connections'].includes(input.handle)) return false;
  // The single conditional write and unique index arbitrate simultaneous claims.
  const result = await db
    .prepare(
      `INSERT INTO profile (user_id, handle, display_name, bio, created_at)
    SELECT user_id, ?, ?, ?, ? FROM membership WHERE user_id = ? AND status = 'active'
    AND NOT EXISTS (SELECT 1 FROM profile WHERE handle = ? AND user_id != ?)
    ON CONFLICT(user_id) DO UPDATE SET handle = excluded.handle,
    display_name = excluded.display_name, bio = excluded.bio`,
    )
    .bind(
      input.handle,
      input.displayName,
      input.bio,
      Date.now(),
      id,
      input.handle,
      id,
    )
    .run();
  return Boolean(result.meta.changes);
}

export async function canReadProfile(
  db: D1Database,
  viewer: string,
  owner: string,
) {
  return Boolean(
    await db
      .prepare(
        `SELECT 1 FROM membership m JOIN membership v ON v.user_id = ?
    WHERE m.user_id = ? AND m.status = 'active' AND v.status = 'active'
    AND NOT EXISTS (SELECT 1 FROM block WHERE (blocker_id = ? AND target_id = ?) OR (blocker_id = ? AND target_id = ?))
    AND (m.user_id = v.user_id OR EXISTS (SELECT 1 FROM follow WHERE follower_id = v.user_id AND target_id = m.user_id AND status = 'accepted'))`,
      )
      .bind(viewer, owner, viewer, owner, owner, viewer)
      .first(),
  );
}

export async function findProfile(
  db: D1Database,
  viewer: string,
  handle: string,
) {
  const row = await db
    .prepare(
      `SELECT p.user_id, p.handle, p.display_name AS displayName,
    CASE WHEN p.user_id = ? OR f.status = 'accepted' THEN p.bio ELSE NULL END AS bio,
    CASE WHEN p.user_id = ? THEN 'self' ELSE COALESCE(f.status, 'none') END AS relationship
    FROM profile p JOIN avatar a ON a.user_id=p.user_id JOIN membership m ON m.user_id = p.user_id
    JOIN membership v ON v.user_id = ? AND v.status = 'active'
    LEFT JOIN follow f ON f.target_id = p.user_id AND f.follower_id = ?
    WHERE p.handle = ? AND m.status = 'active'
    AND NOT EXISTS (SELECT 1 FROM block WHERE (blocker_id = ? AND target_id = p.user_id) OR (blocker_id = p.user_id AND target_id = ?))`,
    )
    .bind(viewer, viewer, viewer, viewer, handle, viewer, viewer)
    .first<{
      user_id: string;
      handle: string;
      displayName: string;
      bio: string | null;
      relationship: 'self' | 'none' | 'pending' | 'accepted';
    }>();
  if (!row) return null;
  const { user_id: id, ...profile } = row;
  return { id, ...profile };
}

export const actions = [
  'request',
  'cancel',
  'accept',
  'deny',
  'unfollow',
  'remove',
  'block',
  'unblock',
] as const;
export type FollowAction = (typeof actions)[number];
export async function changeRelationship(
  db: D1Database,
  actor: string,
  target: string,
  action: FollowAction,
) {
  if (actor === target) return false;
  if (action === 'request') {
    await db
      .prepare(
        `INSERT INTO follow (follower_id, target_id, status, created_at)
      SELECT a.user_id, t.user_id, 'pending', ? FROM profile a JOIN profile t ON t.user_id = ?
      JOIN membership am ON am.user_id = a.user_id AND am.status = 'active'
      JOIN membership tm ON tm.user_id = t.user_id AND tm.status = 'active'
      WHERE a.user_id = ? AND NOT EXISTS (SELECT 1 FROM block WHERE (blocker_id = a.user_id AND target_id = t.user_id) OR (blocker_id = t.user_id AND target_id = a.user_id))
      AND (SELECT COUNT(*) FROM follow WHERE follower_id = a.user_id AND status = 'pending') < 100
      ON CONFLICT DO NOTHING`,
      )
      .bind(Date.now(), target, actor)
      .run();
  } else if (action === 'accept') {
    await db
      .prepare(
        `UPDATE follow SET status = 'accepted' WHERE follower_id = ? AND target_id = ? AND status = 'pending'
      AND EXISTS (SELECT 1 FROM membership WHERE user_id = ? AND status = 'active')
      AND EXISTS (SELECT 1 FROM membership WHERE user_id = ? AND status = 'active')
      AND NOT EXISTS (SELECT 1 FROM block WHERE (blocker_id = ? AND target_id = ?) OR (blocker_id = ? AND target_id = ?))`,
      )
      .bind(target, actor, actor, target, actor, target, target, actor)
      .run();
  } else if (action === 'block') {
    await db.batch([
      db
        .prepare(
          `INSERT INTO block (blocker_id, target_id, created_at) SELECT a.user_id, t.user_id, ? FROM profile a JOIN profile t ON t.user_id = ? WHERE a.user_id = ? ON CONFLICT DO NOTHING`,
        )
        .bind(Date.now(), target, actor),
      db
        .prepare(
          'DELETE FROM follow WHERE (follower_id = ? AND target_id = ?) OR (follower_id = ? AND target_id = ?)',
        )
        .bind(actor, target, target, actor),
    ]);
  } else if (action === 'unblock') {
    await db
      .prepare('DELETE FROM block WHERE blocker_id = ? AND target_id = ?')
      .bind(actor, target)
      .run();
  } else {
    const incoming = action === 'deny' || action === 'remove';
    const pendingOnly = action === 'deny' || action === 'cancel';
    await db
      .prepare(
        `DELETE FROM follow WHERE follower_id = ? AND target_id = ? ${pendingOnly ? "AND status = 'pending'" : ''}`,
      )
      .bind(incoming ? target : actor, incoming ? actor : target)
      .run();
  }
  if (action === 'request')
    return Boolean(
      await db
        .prepare('SELECT 1 FROM follow WHERE follower_id = ? AND target_id = ?')
        .bind(actor, target)
        .first(),
    );
  return true;
}

export type ConnectionKind = 'requests' | 'followers' | 'following' | 'blocked';
export async function listConnections(
  db: D1Database,
  actor: string,
  kind: ConnectionKind,
  after: string,
) {
  return readConnections(db, actor, actor, kind, after);
}

export async function listProfileConnections(
  db: D1Database,
  viewer: string,
  handle: string,
  kind: 'followers' | 'following',
  after: string,
) {
  const profile = await findProfile(db, viewer, handle);
  if (
    !profile ||
    (profile.relationship !== 'self' && profile.relationship !== 'accepted')
  )
    return null;
  return readConnections(db, viewer, profile.id, kind, after);
}

async function readConnections(
  db: D1Database,
  viewer: string,
  owner: string,
  kind: ConnectionKind,
  after: string,
) {
  const incoming = kind === 'requests' || kind === 'followers';
  const query =
    kind === 'blocked'
      ? 'JOIN block f ON f.target_id = p.user_id AND f.blocker_id = owner.user_id'
      : `JOIN follow f ON f.${incoming ? 'follower_id' : 'target_id'} = p.user_id AND f.${incoming ? 'target_id' : 'follower_id'} = owner.user_id AND f.status = '${kind === 'requests' ? 'pending' : 'accepted'}'`;
  const rows = await db
    .prepare(
      `SELECT p.handle, p.display_name AS displayName FROM profile p JOIN avatar a ON a.user_id=p.user_id
    JOIN membership owner ON owner.user_id = ? AND owner.status = 'active'
    JOIN membership viewer ON viewer.user_id = ? AND viewer.status = 'active'
    JOIN avatar owner_avatar ON owner_avatar.user_id = owner.user_id
    ${query}
    JOIN membership m ON m.user_id = p.user_id AND m.status = 'active'
    WHERE p.handle > ?
    AND (owner.user_id = viewer.user_id OR EXISTS (
      SELECT 1 FROM follow access WHERE access.follower_id = viewer.user_id AND access.target_id = owner.user_id AND access.status = 'accepted'))
    AND NOT EXISTS (SELECT 1 FROM block WHERE (blocker_id = viewer.user_id AND target_id = owner.user_id) OR (blocker_id = owner.user_id AND target_id = viewer.user_id))
    ${kind === 'blocked' ? '' : 'AND NOT EXISTS (SELECT 1 FROM block WHERE (blocker_id = viewer.user_id AND target_id = p.user_id) OR (blocker_id = p.user_id AND target_id = viewer.user_id))'}
    ORDER BY p.handle LIMIT 21`,
    )
    .bind(owner, viewer, after)
    .all<{ handle: string; displayName: string }>();
  return {
    items: rows.results.slice(0, 20),
    next: rows.results.length > 20 ? rows.results[19].handle : null,
  };
}

export async function discoverPeople(
  db: D1Database,
  actor: string,
  query: string,
  seed: string,
  after: string,
) {
  const now = Date.now();
  const reserved = await db
    .prepare(
      `INSERT INTO "rateLimit"(id,key,count,lastRequest) VALUES(?,?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN lastRequest<=? THEN 1 ELSE count+1 END,lastRequest=CASE WHEN lastRequest<=? THEN excluded.lastRequest ELSE lastRequest END WHERE lastRequest<=? OR count<30`,
    )
    .bind(
      `discovery:${actor}`,
      `discovery:${actor}`,
      now,
      now - 60000,
      now - 60000,
      now - 60000,
    )
    .run();
  if (!reserved.meta.changes) return null;
  const phase = after ? Number(after[0]) : 0;
  const last = after ? after.slice(2) : '';
  // Fuzzy finder semantics: characters may be omitted, but the remaining letters
  // must stay in order. Escape LIKE metacharacters so input is always literal.
  const pattern =
    '%' +
    Array.from(query, (char) =>
      /[%_\\]/.test(char) ? `\\${char}` : char,
    ).join('%') +
    '%';
  const rows = await db
    .prepare(
      `WITH candidates AS (
    SELECT * FROM (SELECT p.handle,p.display_name AS displayName,p.discovery_key AS key,
      0 AS phase
      FROM profile p JOIN avatar a ON a.user_id=p.user_id JOIN membership m ON m.user_id=p.user_id AND m.status='active'
      WHERE ?=0 AND p.discovery_key>=? AND p.discovery_key>? AND p.user_id!=?
      AND (?='' OR p.handle LIKE ? ESCAPE '\\' OR lower(p.display_name) LIKE ? ESCAPE '\\')
      AND NOT EXISTS(SELECT 1 FROM block WHERE (blocker_id=? AND target_id=p.user_id) OR (blocker_id=p.user_id AND target_id=?))
      ORDER BY p.discovery_key LIMIT 21)
    UNION ALL
    SELECT * FROM (SELECT p.handle,p.display_name AS displayName,p.discovery_key AS key,
      1 AS phase
      FROM profile p JOIN avatar a ON a.user_id=p.user_id JOIN membership m ON m.user_id=p.user_id AND m.status='active'
      WHERE p.discovery_key<? AND p.discovery_key>? AND p.user_id!=?
      AND (?='' OR p.handle LIKE ? ESCAPE '\\' OR lower(p.display_name) LIKE ? ESCAPE '\\')
      AND NOT EXISTS(SELECT 1 FROM block WHERE (blocker_id=? AND target_id=p.user_id) OR (blocker_id=p.user_id AND target_id=?))
      ORDER BY p.discovery_key LIMIT 21)
    ) SELECT * FROM candidates ORDER BY phase,key LIMIT 21`,
    )
    .bind(
      phase,
      seed,
      last,
      actor,
      query,
      pattern,
      pattern,
      actor,
      actor,
      seed,
      phase === 1 ? last : '',
      actor,
      query,
      pattern,
      pattern,
      actor,
      actor,
    )
    .all<{
      handle: string;
      displayName: string;
      key: string;
      phase: number;
    }>();
  const items = rows.results.slice(0, 20);
  const tail = items.at(-1);
  return {
    items: items.map(({ handle, displayName }) => ({
      handle,
      displayName,
    })),
    next: rows.results.length > 20 && tail ? `${tail.phase}:${tail.key}` : null,
  };
}

export async function changeRelationshipByHandle(
  db: D1Database,
  actor: string,
  handle: string,
  action: FollowAction,
) {
  if (!(await ownProfile(db, actor))) return 'profile_required';
  // Blocking must remain available even when the target already blocked us.
  const target =
    action === 'block'
      ? await db
          .prepare(
            "SELECT p.user_id AS id FROM profile p JOIN membership m ON m.user_id=p.user_id WHERE p.handle=? AND m.status='active'",
          )
          .bind(handle)
          .first<{ id: string }>()
      : action === 'unblock'
        ? await db
            .prepare(
              'SELECT p.user_id AS id FROM profile p JOIN block b ON b.target_id=p.user_id WHERE p.handle=? AND b.blocker_id=?',
            )
            .bind(handle, actor)
            .first<{ id: string }>()
        : await findProfile(db, actor, handle);
  if (!target)
    return action === 'block' || action === 'unblock' ? 'ok' : 'missing';
  return (await changeRelationship(db, actor, target.id, action))
    ? 'ok'
    : 'unavailable';
}
