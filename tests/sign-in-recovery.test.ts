import { afterAll, beforeAll, expect, it } from 'vitest';
import { testRuntime, seedProfilePhotos } from './support/runtime';

type Kind = 'regular' | 'invite' | 'event';
let runtime: Awaited<ReturnType<typeof testRuntime>>;
const sent: { to: string[]; text: string }[] = [];
const origin = 'http://localhost:8787';
const fourHours = 4 * 60 * 60 * 1000;
let ip = 0;

beforeAll(async () => {
  runtime = await testRuntime(false, false, async (email) => {
    sent.push(email);
    return { status: 200, body: '{"MessageId":"synthetic"}' };
  });
  await runtime.request('alice', '/api/people/self', 'PUT', {
    handle: 'alice',
    displayName: 'Alice',
    bio: '',
  });
  await seedProfilePhotos(runtime.db);
});
afterAll(async () => runtime?.worker.dispose());

async function invitation(kind: Kind): Promise<string | undefined> {
  if (kind === 'regular') return undefined;
  if (kind === 'invite') {
    const response = await runtime.request('alice', '/api/invite-link', 'POST');
    expect(response.status).toBe(200);
    const link = (await response.json()) as { url: string };
    return new URL(link.url).hash.split('/')[1];
  }
  const id = crypto.randomUUID();
  expect(
    (
      await runtime.request('alice', '/api/events', 'POST', {
        id,
        title: 'Synthetic event',
        description: '',
        location: '',
        startsAt: Date.now() + 86400000,
        endsAt: null,
        timeZone: 'UTC',
      })
    ).status,
  ).toBe(200);
  await runtime.db
    .prepare(
      "UPDATE event SET state='published',object_key='events/test',thumbnail_key='events/test',width=1,height=1 WHERE id=?",
    )
    .bind(id)
    .run();
  const response = await runtime.request('alice', `/api/events/${id}`);
  const { event } = (await response.json()) as { event: { url: string } };
  return new URL(event.url).pathname.split('/')[2];
}

async function requestLink(email: string, kind: Kind, token?: string) {
  const response = await runtime.request(
    null,
    '/api/auth/sign-in/magic-link',
    'POST',
    {
      email,
      callbackURL: '/',
      // The server supplies recovery context even for older clients.
      errorCallbackURL: '/?error=signin',
      ...(kind === 'regular'
        ? {}
        : {
            metadata:
              kind === 'invite' ? { inviteLink: token } : { eventLink: token },
          }),
    },
    { 'CF-Connecting-IP': `192.0.2.${++ip}` },
  );
  expect(response.status).toBe(200);
  const mail = sent.at(-1)!;
  expect(mail.to).toEqual([email]);
  expect(mail.text).toContain('expires in 4 hours and can be used once');
  return new URL(mail.text.match(/https?:\/\/\S+/)![0]);
}

function verify(link: URL) {
  return runtime.worker.dispatchFetch(link.href, {
    redirect: 'manual',
    headers: { 'CF-Connecting-IP': `192.0.2.${++ip}` },
  });
}
function hasSession(response: Awaited<ReturnType<typeof verify>>) {
  return response.headers
    .getSetCookie()
    .some(
      (cookie) =>
        cookie.startsWith('better-auth.session_token=') &&
        !cookie.startsWith('better-auth.session_token=;'),
    );
}

// Assert the actual issued expiry, then age stored expiries instead of waiting
// four hours. Better Auth and membership still run against real Workers/D1.
async function ageLink(
  email: string,
  kind: Kind,
  age: number,
  started: number,
) {
  const verification = await runtime.db
    .prepare(
      "SELECT id,expiresAt FROM verification WHERE json_extract(value,'$.email')=?",
    )
    .bind(email)
    .first<{ id: string; expiresAt: string }>();
  expect(verification).not.toBeNull();
  const expiry = Date.parse(verification!.expiresAt);
  expect(expiry).toBeGreaterThanOrEqual(started + fourHours);
  expect(expiry).toBeLessThanOrEqual(Date.now() + fourHours);
  await runtime.db
    .prepare('UPDATE verification SET expiresAt=? WHERE id=?')
    .bind(new Date(expiry - age).toISOString(), verification!.id)
    .run();
  if (kind !== 'regular') {
    const table = kind === 'invite' ? 'invite_link_claim' : 'event_claim';
    const claim = await runtime.db
      .prepare(`SELECT expires_at FROM ${table} WHERE email=?`)
      .bind(email)
      .first<number>('expires_at');
    expect(claim).toBeGreaterThanOrEqual(started + fourHours);
    expect(claim).toBeLessThanOrEqual(Date.now() + fourHours);
    await runtime.db
      .prepare(`UPDATE ${table} SET expires_at=expires_at-? WHERE email=?`)
      .bind(age, email)
      .run();
  }
}

it.each(['regular', 'invite', 'event'] as const)(
  'accepts %s links just before four hours and consumes them only once',
  async (kind) => {
    const token = await invitation(kind);
    const email =
      kind === 'regular' ? 'bob@example.com' : `${kind}-valid@example.com`;
    const started = Date.now();
    const link = await requestLink(email, kind, token);
    await ageLink(email, kind, fourHours - 60_000, started);
    expect(hasSession(await verify(link))).toBe(true);
    expect(hasSession(await verify(link))).toBe(false);
  },
);

it.each(['invite', 'event'] as const)(
  'preserves %s recovery after failed admission but does not revive a closed invitation',
  async (kind) => {
    const token = await invitation(kind);
    const email = `${kind}-closed@example.com`;
    const link = await requestLink(email, kind, token);
    if (kind === 'invite') {
      await runtime.db
        .prepare("UPDATE invite_link SET revoked_at=? WHERE inviter_id='alice'")
        .bind(Date.now())
        .run();
    } else {
      await runtime.db
        .prepare(
          'UPDATE event SET cancelled_at=? WHERE id=(SELECT event_id FROM event_claim WHERE email=?)',
        )
        .bind(Date.now(), email)
        .run();
    }
    const failed = await verify(link);
    expect(hasSession(failed)).toBe(false);
    expect(failed.status).toBe(303);
    const recovery = new URL(failed.headers.get('Location')!, origin);
    expect(recovery.hash).toBe(`#${kind}/${token}`);
    const count = sent.length;
    const resend = await runtime.request(
      null,
      '/api/auth/sign-in/magic-link',
      'POST',
      {
        email,
        metadata:
          kind === 'invite'
            ? { inviteLink: recovery.hash.split('/')[1] }
            : { eventLink: recovery.hash.split('/')[1] },
      },
      { 'CF-Connecting-IP': `192.0.2.${++ip}` },
    );
    expect(resend.status).toBe(403);
    expect(await resend.json()).toMatchObject({ code: 'INVITATION_REQUIRED' });
    expect(sent).toHaveLength(count);
  },
);

it('rejects an external recovery destination without redirecting off-site', async () => {
  const link = new URL(
    '/api/auth/magic-link/verify?token=synthetic&callbackURL=/',
    origin,
  );
  link.searchParams.set('errorCallbackURL', 'https://elsewhere.example/');
  const failed = await verify(link);
  expect(hasSession(failed)).toBe(false);
  expect(failed.status).toBe(303);
  expect(failed.headers.get('Location')).toBe('/?error=signin');
});

it.each(['regular', 'invite', 'event'] as const)(
  'rejects expired %s links and recovers through a fresh email with the same invitation',
  async (kind) => {
    const token = await invitation(kind);
    const email =
      kind === 'regular' ? 'carol@example.com' : `${kind}-expired@example.com`;
    const started = Date.now();
    const link = await requestLink(email, kind, token);
    await ageLink(email, kind, fourHours + 1000, started);
    const expired = await verify(link);
    expect(hasSession(expired)).toBe(false);
    const recovery = new URL(expired.headers.get('Location')!);
    expect(recovery.origin).toBe(origin);
    expect(recovery.pathname).toBe('/');
    expect(recovery.searchParams.get('error')).toBe('INVALID_TOKEN');
    expect(recovery.hash).toBe(kind === 'regular' ? '' : `#${kind}/${token}`);
    expect(recovery.href).not.toContain(email);
    expect(recovery.href).not.toContain(link.searchParams.get('token'));

    const fresh = await requestLink(email, kind, recovery.hash.split('/')[1]);
    expect(fresh.searchParams.get('token')).not.toBe(
      link.searchParams.get('token'),
    );
    expect(hasSession(await verify(fresh))).toBe(true);
    if (kind !== 'regular') {
      const provenance = await runtime.db
        .prepare(
          `SELECT m.invited_by,i.invite_link_id,i.event_link_id FROM membership m
         JOIN user u ON u.id=m.user_id JOIN invitation i ON i.id=m.invitation_id
         WHERE u.email=?`,
        )
        .bind(email)
        .first<{
          invited_by: string;
          invite_link_id: string | null;
          event_link_id: string | null;
        }>();
      expect(provenance?.invited_by).toBe('alice');
      const source =
        kind === 'invite'
          ? await runtime.db
              .prepare("SELECT id FROM invite_link WHERE inviter_id='alice'")
              .first<string>('id')
          : await runtime.db
              .prepare('SELECT link_id FROM event_claim WHERE email=?')
              .bind(email)
              .first<string>('link_id');
      expect(
        kind === 'invite'
          ? provenance?.invite_link_id
          : provenance?.event_link_id,
      ).toBe(source);
    }
  },
);
