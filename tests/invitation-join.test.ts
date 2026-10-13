import { afterEach, beforeEach, expect, it } from 'vitest';
import { seedProfilePhotos, testRuntime } from './support/runtime';

let runtime: Awaited<ReturnType<typeof testRuntime>>;
let sent: { to: string[]; text: string; subject: string }[];
let requestNumber = 0;
const origin = 'http://localhost:8787';
beforeEach(async () => {
  sent = [];
  runtime = await testRuntime(false, false, async (request) => {
    sent.push((await request.json()) as (typeof sent)[number]);
    return { status: 200, body: '{"id":"synthetic-message"}' };
  });
  for (const id of ['alice', 'bob'])
    await runtime.request(id, '/api/people/self', 'PUT', {
      handle: id,
      displayName: id === 'alice' ? 'Alice Example' : 'Bob',
      bio: '',
    });
  await seedProfilePhotos(runtime.db);
});
afterEach(async () => {
  await runtime?.worker.dispose();
});

async function invite(email = 'new@example.com', actor = 'alice') {
  const response = await runtime.request(actor, '/api/invitations', 'POST', {
    email,
  });
  expect(response.status).toBe(201);
  const body = (await response.json()) as {
    invitation: { id: string; expiresAt: number };
  };
  const message = sent.at(-1)!;
  const url = new URL(message.text.match(/https?:\/\/\S+/)![0]);
  expect(url.pathname).toBe('/join');
  expect(url.search).toBe('');
  const token = url.hash.slice(1);
  expect(token).toMatch(/^[a-zA-Z0-9]{48}$/);
  expect(JSON.stringify(body)).not.toContain(token);
  return { ...body.invitation, token, email };
}
function auth(
  action: string,
  token: string,
  headers: Record<string, string> = {},
) {
  return runtime.request(
    null,
    `/api/auth/invitation/${action}`,
    'POST',
    { token },
    { 'CF-Connecting-IP': `192.0.2.${++requestNumber}`, ...headers },
  );
}
function cookie(response: Awaited<ReturnType<typeof auth>>) {
  const value = response.headers
    .getSetCookie()
    .find((item) => item.startsWith('better-auth.session_token='));
  expect(value).toBeDefined();
  expect(value).toContain('HttpOnly');
  return value!.split(';')[0];
}
async function assertNoJoinedUser(email: string) {
  expect(
    await runtime.db
      .prepare(
        'SELECT 1 FROM user u JOIN membership m ON m.user_id=u.id WHERE u.email=?',
      )
      .bind(email)
      .first(),
  ).toBeNull();
  expect(
    await runtime.db
      .prepare(
        'SELECT 1 FROM user u JOIN session s ON s.userId=u.id WHERE u.email=?',
      )
      .bind(email)
      .first(),
  ).toBeNull();
}

it('previews without consuming and accepts once into normal onboarding using only the invitation email', async () => {
  const invitation = await invite();
  expect(invitation.expiresAt - Date.now()).toBeGreaterThan(6.99 * 86400000);
  const stored = await runtime.db
    .prepare('SELECT join_token_hash,email_payload FROM invitation WHERE id=?')
    .bind(invitation.id)
    .first<{ join_token_hash: string; email_payload: string | null }>();
  expect(stored!.join_token_hash).toMatch(/^[a-f0-9]{64}$/);
  expect(stored!.join_token_hash).not.toBe(invitation.token);
  expect(stored!.email_payload).toBeNull();
  for (let i = 0; i < 2; i++) {
    const response = await auth('preview', invitation.token);
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await response.json()).toMatchObject({
      status: 'ready',
      email: invitation.email,
      inviter: { name: 'Alice Example', handle: 'alice' },
      signedInAs: null,
    });
    expect(response.headers.getSetCookie()).toEqual([]);
  }
  const get = await runtime.request(
    null,
    `/api/auth/invitation/accept?token=${invitation.token}`,
  );
  expect(get.status).toBeGreaterThanOrEqual(400);
  expect(
    await runtime.db
      .prepare('SELECT 1 FROM user WHERE email=?')
      .bind(invitation.email)
      .first(),
  ).toBeNull();
  const response = await auth('accept', invitation.token);
  expect(response.status).toBe(200);
  const sessionCookie = cookie(response);
  expect(await response.json()).toEqual({ ok: true });
  expect(sent).toHaveLength(1);
  const me = await runtime.request(null, '/api/bootstrap', 'GET', undefined, {
    Cookie: sessionCookie,
  });
  const bootstrap = (await me.json()) as {
    user: { id: string };
    profile: unknown;
  };
  expect(bootstrap.user.id).toBeTruthy();
  expect(bootstrap.profile).toBeNull();
  const member = await runtime.db
    .prepare(
      'SELECT m.*,u.emailVerified FROM membership m JOIN user u ON u.id=m.user_id WHERE m.user_id=?',
    )
    .bind(bootstrap.user.id)
    .first();
  expect(member).toMatchObject({
    invited_by: 'alice',
    invitation_id: invitation.id,
    emailVerified: 1,
    status: 'active',
  });
  expect(
    (await runtime.db
      .prepare('SELECT accepted_by FROM invitation WHERE id=?')
      .bind(invitation.id)
      .first())!.accepted_by,
  ).toBe(bootstrap.user.id);
  const replay = await auth('accept', invitation.token);
  expect(replay.status).toBe(400);
  expect(replay.headers.getSetCookie()).toEqual([]);
  expect(await (await auth('preview', invitation.token)).json()).toEqual({
    status: 'used',
  });
  expect(
    (await runtime.db
      .prepare('SELECT COUNT(*) AS n FROM session WHERE userId=?')
      .bind(bootstrap.user.id)
      .first())!.n,
  ).toBe(1);
  await runtime.request(
    null,
    '/api/people/self',
    'PUT',
    { handle: 'newfriend', displayName: 'New Friend', bio: '' },
    { Cookie: sessionCookie },
  );
  const follows = await runtime.db
    .prepare('SELECT * FROM follow WHERE follower_id=? OR target_id=?')
    .bind(bootstrap.user.id, bootstrap.user.id)
    .all();
  expect(follows.results).toHaveLength(2);
});

it.each(['cancelled', 'expired', 'inactive'] as const)(
  'rejects %s invitations even after a successful preview',
  async (scenario) => {
    const invitation = await invite();
    expect(
      await (await auth('preview', invitation.token)).json(),
    ).toMatchObject({ status: 'ready' });
    if (scenario === 'cancelled')
      await runtime.request(
        'alice',
        `/api/invitations/${invitation.id}`,
        'DELETE',
      );
    if (scenario === 'expired') {
      // Keep the issuance/expiry constraint valid while crossing the expiry boundary.
      await runtime.db.exec('DROP TRIGGER invitation_immutable_provenance');
      await runtime.db
        .prepare('UPDATE invitation SET created_at=?,expires_at=? WHERE id=?')
        .bind(Date.now() - 86400000, Date.now() - 1000, invitation.id)
        .run();
    }
    if (scenario === 'inactive')
      await runtime.db
        .prepare(
          "UPDATE membership SET status='disabled' WHERE user_id='alice'",
        )
        .run();
    const response = await auth('accept', invitation.token);
    expect(response.status).toBe(400);
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(await (await auth('preview', invitation.token)).json()).toEqual({
      status: scenario === 'inactive' ? 'cancelled' : scenario,
    });
    await assertNoJoinedUser(invitation.email);
  },
);

it('does not use a different active invitation to bypass cancellation of the linked invitation', async () => {
  const first = await invite();
  const second = await invite(first.email, 'bob');
  await runtime.request('alice', `/api/invitations/${first.id}`, 'DELETE');
  expect((await auth('accept', first.token)).status).toBe(400);
  const accepted = await auth('accept', second.token);
  expect(accepted.status).toBe(200);
  expect(
    await runtime.db
      .prepare(
        'SELECT invited_by,invitation_id FROM membership WHERE invitation_id=?',
      )
      .bind(second.id)
      .first(),
  ).toEqual({ invited_by: 'bob', invitation_id: second.id });
  expect(await (await auth('preview', first.token)).json()).toEqual({
    status: 'used',
  });
});

it('credits the chosen invitation when multiple still-valid invitations exist', async () => {
  const first = await invite();
  const second = await invite(first.email, 'bob');
  expect((await auth('accept', second.token)).status).toBe(200);
  expect(
    await runtime.db
      .prepare(
        'SELECT invited_by,invitation_id FROM membership WHERE invitation_id=?',
      )
      .bind(second.id)
      .first(),
  ).toEqual({ invited_by: 'bob', invitation_id: second.id });
  expect((await auth('accept', first.token)).status).toBe(400);
});

it('invalidates every join link when the recipient joins through normal email sign-in and keeps its ten-minute expiry', async () => {
  const invitation = await invite();
  const second = await invite(invitation.email, 'bob');
  const requested = await runtime.request(
    null,
    '/api/auth/sign-in/magic-link',
    'POST',
    { email: invitation.email, callbackURL: '/' },
    { 'CF-Connecting-IP': '198.51.100.1' },
  );
  expect(requested.status).toBe(200);
  const link = sent.at(-1)!.text.match(/https?:\/\/\S+/)![0];
  const verification = await runtime.db
    .prepare(
      "SELECT expiresAt FROM verification WHERE identifier LIKE 'magic-link:%'",
    )
    .first<{ expiresAt: string }>();
  const remaining = new Date(verification!.expiresAt).getTime() - Date.now();
  expect(remaining).toBeLessThanOrEqual(600000);
  expect(remaining).toBeGreaterThan(590000);
  const signedIn = await runtime.worker.dispatchFetch(link, {
    headers: { Origin: origin },
    redirect: 'manual',
  });
  expect(signedIn.status).toBe(302);
  cookie(signedIn);
  for (const token of [invitation.token, second.token]) {
    expect(await (await auth('preview', token)).json()).toEqual({
      status: 'used',
    });
    expect((await auth('accept', token)).status).toBe(400);
  }
});

it('issues one membership and one session for concurrent acceptances, including two different invitation links', async () => {
  const first = await invite();
  const second = await invite(first.email, 'bob');
  const responses = await Promise.all([
    auth('accept', first.token),
    auth('accept', first.token),
    auth('accept', second.token),
  ]);
  expect(responses.filter((r) => r.status === 200)).toHaveLength(1);
  expect(responses.filter((r) => r.status === 400)).toHaveLength(2);
  expect(
    (await runtime.db
      .prepare(
        'SELECT COUNT(*) AS n FROM session s JOIN user u ON u.id=s.userId WHERE u.email=?',
      )
      .bind(first.email)
      .first())!.n,
  ).toBe(1);
});

it('does not replace an existing signed-in account without explicit sign-out', async () => {
  const invitation = await invite();
  const preview = await runtime.request(
    'bob',
    '/api/auth/invitation/preview',
    'POST',
    { token: invitation.token },
  );
  expect(await preview.json()).toMatchObject({
    status: 'ready',
    signedInAs: 'bob@example.com',
  });
  const response = await runtime.request(
    'bob',
    '/api/auth/invitation/accept',
    'POST',
    { token: invitation.token },
  );
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ code: 'SIGN_OUT_REQUIRED' });
  expect(response.headers.getSetCookie()).toEqual([]);
  await assertNoJoinedUser(invitation.email);
  expect((await auth('accept', invitation.token)).status).toBe(200);
});

it('rechecks cancellation atomically after identity creation, before granting membership or a session', async () => {
  const invitation = await invite();
  await runtime.db
    .prepare(
      `CREATE TRIGGER cancel_during_join AFTER INSERT ON user
    WHEN NEW.email='new@example.com' BEGIN
    UPDATE invitation SET revoked_at=1 WHERE recipient_email=NEW.email;
    END;`,
    )
    .run();
  const response = await auth('accept', invitation.token);
  expect(response.status).toBe(400);
  expect(response.headers.getSetCookie()).toEqual([]);
  await assertNoJoinedUser(invitation.email);
});

it('preserves membership and falls back to ordinary sign-in if session creation fails after acceptance', async () => {
  const invitation = await invite();
  await runtime.db
    .prepare(
      `CREATE TRIGGER fail_join_session BEFORE INSERT ON session
    WHEN (SELECT email FROM user WHERE id=NEW.userId)='new@example.com'
    BEGIN SELECT RAISE(ABORT, 'synthetic_session_failure'); END;`,
    )
    .run();
  const response = await auth('accept', invitation.token);
  expect(response.status).toBe(500);
  expect(response.headers.getSetCookie()).toEqual([]);
  expect(await (await auth('preview', invitation.token)).json()).toEqual({
    status: 'used',
  });
  await runtime.db.exec('DROP TRIGGER fail_join_session');
  expect((await auth('accept', invitation.token)).status).toBe(400);
  const requested = await runtime.request(
    null,
    '/api/auth/sign-in/magic-link',
    'POST',
    { email: invitation.email, callbackURL: '/' },
    { 'CF-Connecting-IP': '198.51.100.2' },
  );
  expect(requested.status).toBe(200);
  const link = sent.at(-1)!.text.match(/https?:\/\/\S+/)![0];
  const signedIn = await runtime.worker.dispatchFetch(link, {
    redirect: 'manual',
    headers: { Origin: origin },
  });
  expect(signedIn.status).toBe(302);
  cookie(signedIn);
});

it('rejects substituted email/IDs, cross-origin requests, malformed credentials and rate-limits guesses', async () => {
  const invitation = await invite();
  expect(
    (
      await auth('accept', invitation.token, {
        Origin: 'https://other.example',
      })
    ).status,
  ).toBe(403);
  expect((await auth('accept', invitation.id)).status).toBe(400);
  expect(await (await auth('preview', 'z'.repeat(48))).json()).toEqual({
    status: 'invalid',
  });
  for (let i = 0; i < 10; i++)
    expect(
      (
        await auth('preview', 'z'.repeat(48), {
          'CF-Connecting-IP': '203.0.113.50',
        })
      ).status,
    ).toBe(200);
  expect(
    (
      await auth('preview', invitation.token, {
        'CF-Connecting-IP': '203.0.113.50',
      })
    ).status,
  ).toBe(429);
  const accepted = await runtime.request(
    null,
    '/api/auth/invitation/accept',
    'POST',
    {
      token: invitation.token,
      email: 'attacker@example.com',
      invitationId: 'bob',
    },
    { 'CF-Connecting-IP': '203.0.113.51' },
  );
  expect(accepted.status).toBe(200);
  expect(
    await runtime.db
      .prepare("SELECT 1 FROM user WHERE email='attacker@example.com'")
      .first(),
  ).toBeNull();
  expect(
    await runtime.db
      .prepare(
        'SELECT 1 FROM user u JOIN membership m ON m.user_id=u.id WHERE u.email=?',
      )
      .bind(invitation.email)
      .first(),
  ).not.toBeNull();
});
