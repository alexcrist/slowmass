import { afterEach, beforeEach, expect, it } from 'vitest';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { testRuntime, seedProfilePhotos } from './support/runtime';
import { invitationTokenHash } from '../src/server/membership';

let runtime: Awaited<ReturnType<typeof testRuntime>>;
let sent: { to: string[]; text: string }[];
let ip = 0;
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const codes = new Map<
  string,
  { challenge: string; profile: Record<string, unknown> }
>();
function idToken(profile: Record<string, unknown>) {
  const data = [
    { alg: 'RS256', kid: 'synthetic' },
    {
      iss: 'https://accounts.google.com',
      aud: 'synthetic-google-client',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      ...profile,
    },
  ]
    .map((v) => Buffer.from(JSON.stringify(v)).toString('base64url'))
    .join('.');
  return `${data}.${sign('RSA-SHA256', Buffer.from(data), keys.privateKey).toString('base64url')}`;
}
beforeEach(async () => {
  sent = [];
  codes.clear();
  runtime = await testRuntime(
    false,
    false,
    async (req) => {
      sent.push((await req.json()) as (typeof sent)[number]);
      return { status: 200, body: '{"id":"synthetic"}' };
    },
    undefined,
    undefined,
    async (req) => {
      if (req.url.endsWith('/certs'))
        return {
          status: 200,
          body: JSON.stringify({
            keys: [
              {
                ...keys.publicKey.export({ format: 'jwk' }),
                kid: 'synthetic',
                alg: 'RS256',
              },
            ],
          }),
        };
      const body = new URLSearchParams(await req.text());
      const record = codes.get(body.get('code') ?? '');
      if (
        !record ||
        createHash('sha256')
          .update(body.get('code_verifier') ?? '')
          .digest('base64url') !== record.challenge
      )
        return { status: 400, body: '{"error":"invalid_grant"}' };
      codes.delete(body.get('code')!);
      expect(body.get('redirect_uri')).toBe(
        'http://localhost:8787/api/auth/callback/google',
      );
      return {
        status: 200,
        body: JSON.stringify({
          access_token: 'synthetic-access',
          token_type: 'Bearer',
          expires_in: 3600,
          id_token: idToken(record.profile),
        }),
      };
    },
  );
  await runtime.request('alice', '/api/people/self', 'PUT', {
    handle: 'alice',
    displayName: 'Alice',
    bio: '',
  });
  await seedProfilePhotos(runtime.db);
});
afterEach(async () => {
  await runtime?.worker.dispose();
});
function headers() {
  return { 'CF-Connecting-IP': `192.0.2.${++ip}` };
}
async function begin(additionalData?: unknown, extra = {}) {
  const response = await runtime.request(
    null,
    '/api/auth/sign-in/social',
    'POST',
    { provider: 'google', disableRedirect: true, additionalData, ...extra },
    headers(),
  );
  expect(response.status).toBe(200);
  const url = new URL(((await response.json()) as { url: string }).url);
  expect(url.origin).toBe('https://accounts.google.com');
  expect(new Set(url.searchParams.get('scope')!.split(' '))).toEqual(
    new Set(['openid', 'email']),
  );
  expect(url.searchParams.get('include_granted_scopes')).not.toBe('true');
  return {
    url,
    cookie: response.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; '),
  };
}
async function finish(
  flow: Awaited<ReturnType<typeof begin>>,
  email: string,
  profile: Record<string, unknown> = {},
  cookie = flow.cookie,
) {
  const code = crypto.randomUUID();
  codes.set(code, {
    challenge: flow.url.searchParams.get('code_challenge')!,
    profile: {
      sub: email,
      email,
      email_verified: true,
      name: 'Provider name',
      picture: 'https://example.invalid/avatar',
      ...profile,
    },
  });
  return runtime.worker.dispatchFetch(
    `http://localhost:8787/api/auth/callback/google?state=${encodeURIComponent(flow.url.searchParams.get('state')!)}&code=${code}`,
    { headers: { Cookie: cookie, ...headers() }, redirect: 'manual' },
  );
}
function signedIn(response: Awaited<ReturnType<typeof finish>>) {
  return response.headers
    .getSetCookie()
    .some((c) => c.includes('session_token='));
}
async function invite() {
  const response = await runtime.request('alice', '/api/invite-link', 'POST');
  return ((await response.json()) as { url: string }).url.split('#invite/')[1];
}
async function event() {
  const token = 'E'.repeat(48);
  await runtime.db
    .prepare(
      `INSERT INTO event(id,creator_id,title,starts_at,time_zone,state,object_key,thumbnail_key,link_id,link_hash,created_at) VALUES ('event','alice','Dinner',?,'UTC','published','cover','thumbnail','event-version',?,?)`,
    )
    .bind(Date.now() + 86400000, await invitationTokenHash(token), Date.now())
    .run();
  return token;
}
async function member(email: string) {
  return runtime.db
    .prepare(
      `SELECT u.id,u.email,u.image,m.invited_by,i.invite_link_id,i.event_id,i.event_link_id FROM user u JOIN membership m ON m.user_id=u.id LEFT JOIN invitation i ON i.id=m.invitation_id WHERE u.email=?`,
    )
    .bind(email)
    .first();
}
it('links verified Google to an existing dotted Gmail account and magic-link aliases reach the same ID', async () => {
  await runtime.db
    .prepare(
      "UPDATE user SET email='a.li.ce+original@gmail.com' WHERE id='alice'",
    )
    .run();
  const response = await finish(await begin(), 'alice@gmail.com');
  expect(signedIn(response)).toBe(true);
  expect(
    await runtime.db
      .prepare(
        "SELECT userId,accessToken,refreshToken,idToken FROM account WHERE providerId='google'",
      )
      .first(),
  ).toEqual({
    userId: 'alice',
    accessToken: null,
    refreshToken: null,
    idToken: null,
  });
  expect(
    await runtime.db.prepare('SELECT COUNT(*) AS n FROM user').first('n'),
  ).toBe(4);
  const email = await runtime.request(
    null,
    '/api/auth/sign-in/magic-link',
    'POST',
    { email: 'a.l.i.c.e+new@googlemail.com' },
    headers(),
  );
  expect(email.status).toBe(200);
  expect(sent[0].to).toEqual(['a.li.ce+original@gmail.com']);
  const url = sent[0].text.match(/https?:\/\/\S+/)![0];
  expect(
    signedIn(
      await runtime.worker.dispatchFetch(url, {
        headers: headers(),
        redirect: 'manual',
      }),
    ),
  ).toBe(true);
  expect((await member('a.li.ce+original@gmail.com'))?.id).toBe('alice');
});
it('admits a new Google member only through the exact invite version, then allows email sign-in', async () => {
  const token = await invite();
  const response = await finish(
    await begin({ inviteLink: token }),
    'new.person+tag@gmail.com',
    { name: undefined, picture: undefined },
  );
  expect(signedIn(response)).toBe(true);
  expect(response.headers.get('location')).toBe(`/#invite/${token}`);
  const joined = await member('newperson@gmail.com');
  expect(joined).toMatchObject({
    invited_by: 'alice',
    event_id: null,
    image: null,
  });
  expect(joined?.invite_link_id).toBe(
    await runtime.db
      .prepare("SELECT id FROM invite_link WHERE inviter_id='alice'")
      .first('id'),
  );
  expect(
    (
      await runtime.request(
        null,
        '/api/auth/sign-in/magic-link',
        'POST',
        { email: 'new.person@gmail.com' },
        headers(),
      )
    ).status,
  ).toBe(200);
  const verified = await runtime.worker.dispatchFetch(
    sent[0].text.match(/https?:\/\/\S+/)![0],
    { headers: headers(), redirect: 'manual' },
  );
  expect(signedIn(verified)).toBe(true);
  expect((await member('newperson@gmail.com'))?.id).toBe(joined?.id);
});
it('records event provenance for new people and access without changing existing attribution', async () => {
  const token = await event();
  expect(
    signedIn(
      await finish(await begin({ eventLink: token }), 'guest@gmail.com'),
    ),
  ).toBe(true);
  expect(await member('guest@gmail.com')).toMatchObject({
    invited_by: 'alice',
    event_id: 'event',
    event_link_id: 'event-version',
  });
  const guest = await member('guest@gmail.com');
  expect(
    await runtime.db
      .prepare('SELECT link_id FROM event_access WHERE user_id=?')
      .bind(guest!.id)
      .first('link_id'),
  ).toBe('event-version');
  await runtime.db
    .prepare("UPDATE user SET email='bob@gmail.com' WHERE id='bob'")
    .run();
  expect(
    signedIn(await finish(await begin({ eventLink: token }), 'bob@gmail.com')),
  ).toBe(true);
  expect(
    await runtime.db
      .prepare("SELECT invitation_id FROM membership WHERE user_id='bob'")
      .first('invitation_id'),
  ).toBe('bob');
  expect(
    await runtime.db
      .prepare("SELECT link_id FROM event_access WHERE user_id='bob'")
      .first('link_id'),
  ).toBe('event-version');
});
it('rejects uninvited, unverified and unmanaged third-party Google emails without linking accounts', async () => {
  const rejected = await finish(await begin(), 'stranger@gmail.com');
  expect(signedIn(rejected)).toBe(false);
  expect(rejected.status).toBe(302);
  const recovery = new URL(
    rejected.headers.get('location')!,
    'http://localhost:8787',
  );
  expect(recovery.pathname).toBe('/');
  expect(recovery.searchParams.get('auth')).toBe('google');
  expect(recovery.searchParams.get('error')).toBe('INVITATION_REQUIRED');
  expect(await member('stranger@gmail.com')).toBeNull();
  const token = await invite();
  for (const [email, profile] of [
    ['unverified@gmail.com', { email_verified: false }],
    ['outsider@example.com', {}],
  ] as const) {
    expect(
      signedIn(
        await finish(await begin({ inviteLink: token }), email, profile),
      ),
    ).toBe(false);
    expect(await member(email)).toBeNull();
  }
  expect(
    await runtime.db.prepare('SELECT COUNT(*) AS n FROM account').first('n'),
  ).toBe(0);
});
it('does not normalize Workspace dots or tags and permits a verified managed account', async () => {
  const token = await invite();
  expect(
    signedIn(
      await finish(
        await begin({ inviteLink: token }),
        'first.last+tag@example.com',
        { hd: 'example.com' },
      ),
    ),
  ).toBe(true);
  expect(await member('first.last+tag@example.com')).not.toBeNull();
  expect(await member('firstlast@example.com')).toBeNull();
});
it('rejects revoked invitation claims and cancelled event claims instead of falling back', async () => {
  const token = await invite();
  const flow = await begin({ inviteLink: token });
  await runtime.db
    .prepare('UPDATE invite_link SET revoked_at=?')
    .bind(Date.now())
    .run();
  expect(signedIn(await finish(flow, 'revoked@gmail.com'))).toBe(false);
  const eventToken = await event();
  const eventFlow = await begin({ eventLink: eventToken });
  await runtime.db
    .prepare('UPDATE event SET cancelled_at=?')
    .bind(Date.now())
    .run();
  expect(signedIn(await finish(eventFlow, 'cancelled@gmail.com'))).toBe(false);
});
it('requires the state cookie, rejects replay and ignores forged server context', async () => {
  const token = await invite();
  const flow = await begin({ inviteLink: token });
  expect(signedIn(await finish(flow, 'cookie@gmail.com', {}, ''))).toBe(false);
  const valid = await begin({ inviteLink: token });
  expect(signedIn(await finish(valid, 'valid@gmail.com'))).toBe(true);
  expect(signedIn(await finish(valid, 'replay@gmail.com'))).toBe(false);
  expect(
    signedIn(
      await finish(
        await begin({
          serverContext: {
            slowmassGoogle: true,
            source: 'invite',
            claim: 'forged',
          },
        }),
        'forged@gmail.com',
      ),
    ),
  ).toBe(false);
});
it('rejects disabled members, client ID tokens, extra scopes, foreign origins and direct account linking', async () => {
  await runtime.db
    .prepare("UPDATE user SET email='bob@gmail.com' WHERE id='bob'")
    .run();
  await runtime.db
    .prepare("UPDATE membership SET status='disabled' WHERE user_id='bob'")
    .run();
  expect(signedIn(await finish(await begin(), 'bob@gmail.com'))).toBe(false);
  for (const extra of [
    { idToken: { token: 'forged' } },
    { scopes: ['https://www.googleapis.com/auth/drive'] },
  ])
    expect(
      (
        await runtime.request(
          null,
          '/api/auth/sign-in/social',
          'POST',
          { provider: 'google', ...extra },
          headers(),
        )
      ).status,
    ).toBe(400);
  expect(
    (
      await runtime.request(
        null,
        '/api/auth/sign-in/social',
        'POST',
        { provider: 'google' },
        { ...headers(), Origin: 'https://evil.example' },
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await runtime.request(
        'alice',
        '/api/auth/link-social',
        'POST',
        { provider: 'google' },
        headers(),
      )
    ).status,
  ).toBe(400);
});
it('fails closed if a pinned claim expires, disappears or changes version while at Google', async () => {
  const token = await invite();
  const flow = await begin({ inviteLink: token });
  await runtime.db.prepare('DELETE FROM invite_link_claim').run();
  expect(signedIn(await finish(flow, 'missing@gmail.com'))).toBe(false);
  const expired = await begin({ inviteLink: token });
  await runtime.db.prepare('UPDATE invite_link_claim SET expires_at=0').run();
  expect(signedIn(await finish(expired, 'expired@gmail.com'))).toBe(false);
  const eventToken = await event();
  const changed = await begin({ eventLink: eventToken });
  await runtime.db.prepare("UPDATE event SET link_id='new-version'").run();
  expect(signedIn(await finish(changed, 'version@gmail.com'))).toBe(false);
});
it('concurrent Google callbacks retain a single identity and provider binding, with retry recovery', async () => {
  const token = await invite();
  const flows = await Promise.all([
    begin({ inviteLink: token }),
    begin({ inviteLink: token }),
  ]);
  const results = await Promise.all(
    flows.map((flow) => finish(flow, 'race@gmail.com')),
  );
  expect(results.some(signedIn)).toBe(true);
  expect(
    await runtime.db
      .prepare("SELECT COUNT(*) AS n FROM user WHERE email='race@gmail.com'")
      .first('n'),
  ).toBe(1);
  expect(
    await runtime.db
      .prepare(
        "SELECT COUNT(*) AS n FROM account WHERE providerId='google' AND accountId='race@gmail.com'",
      )
      .first('n'),
  ).toBe(1);
  expect(signedIn(await finish(await begin(), 'race@gmail.com'))).toBe(true);
});
it('preserves the existing provider owner when a Google email changes and denies blocked event access', async () => {
  await runtime.db
    .prepare("UPDATE user SET email='bob@gmail.com' WHERE id='bob'")
    .run();
  expect(
    signedIn(
      await finish(await begin(), 'bob@gmail.com', { sub: 'stable-bob' }),
    ),
  ).toBe(true);
  expect(
    signedIn(
      await finish(await begin(), 'changed@gmail.com', { sub: 'stable-bob' }),
    ),
  ).toBe(false);
  expect(
    await runtime.db
      .prepare("SELECT userId FROM account WHERE accountId='stable-bob'")
      .first('userId'),
  ).toBe('bob');
  const token = await event();
  await runtime.request('bob', '/api/people/self', 'PUT', {
    handle: 'bob',
    displayName: 'Bob',
    bio: '',
  });
  await runtime.db
    .prepare(
      "INSERT INTO block(blocker_id,target_id,created_at) VALUES ('alice','bob',?)",
    )
    .bind(Date.now())
    .run();
  const response = await finish(
    await begin({ eventLink: token }),
    'bob@gmail.com',
    { sub: 'stable-bob' },
  );
  expect(signedIn(response)).toBe(true); // Member may still sign in; event access remains denied.
  expect(
    await runtime.db
      .prepare("SELECT 1 FROM event_access WHERE user_id='bob'")
      .first(),
  ).toBeNull();
});

it('advertises configured Google sign-in without exposing credentials', async () => {
  const response = await runtime.request(null, '/api/bootstrap');
  const data = await response.json();
  expect(data).toMatchObject({ googleSignInAvailable: true, user: null });
  expect(JSON.stringify(data)).not.toContain('synthetic-google-client');
});

it.each(['normal', 'invite', 'event'] as const)(
  'preserves %s context and Google recovery copy on cancellation',
  async (kind) => {
    const token =
      kind === 'invite'
        ? await invite()
        : kind === 'event'
          ? await event()
          : null;
    const flow = await begin(
      token
        ? { [kind === 'event' ? 'eventLink' : 'inviteLink']: token }
        : undefined,
    );
    const response = await runtime.worker.dispatchFetch(
      `http://localhost:8787/api/auth/callback/google?state=${encodeURIComponent(flow.url.searchParams.get('state')!)}&error=access_denied`,
      { headers: { Cookie: flow.cookie, ...headers() }, redirect: 'manual' },
    );
    const destination = new URL(
      response.headers.get('Location')!,
      'http://localhost:8787',
    );
    expect(destination.searchParams.get('auth')).toBe('google');
    expect(destination.hash).toBe(token ? `#${kind}/${token}` : '');
    expect(signedIn(response)).toBe(false);
  },
);
