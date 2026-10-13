import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { seedProfilePhotos, testRuntime } from './support/runtime';

let runtime: Awaited<ReturnType<typeof testRuntime>>;
const sent: {
  key: string | null;
  body: { to: string[]; text: string; subject: string };
}[] = [];
let providerStatus = 200;
beforeAll(async () => {
  runtime = await testRuntime(false, false, async (request) => {
    sent.push({
      key: request.headers.get('Idempotency-Key'),
      body: (await request.json()) as (typeof sent)[number]['body'],
    });
    return {
      status: providerStatus,
      body: JSON.stringify({ id: 'synthetic-message' }),
    };
  });
  for (const id of ['alice', 'bob'])
    await runtime.request(id, '/api/people/self', 'PUT', {
      handle: id,
      displayName: id === 'alice' ? 'Alice Example' : 'Bob',
      bio: '',
    });
  await seedProfilePhotos(runtime.db);
});
afterAll(async () => {
  await runtime?.worker.dispose();
});
beforeEach(async () => {
  sent.length = 0;
  providerStatus = 200;
  await runtime.db.batch([
    runtime.db.prepare(
      "DELETE FROM invitation WHERE id NOT IN ('bob','carol','david')",
    ),
    runtime.db.prepare('DELETE FROM email_budget'),
  ]);
});
async function create() {
  return runtime.request('alice', '/api/invitations', 'POST', {
    email: ' Friend@Example.com ',
  });
}
async function row() {
  return runtime.db
    .prepare(
      "SELECT * FROM invitation WHERE recipient_email='friend@example.com'",
    )
    .first<{
      id: string;
      created_at: number;
      email_attempted_at: number;
      email_last_attempt_at: number;
      email_sent_at: number | null;
      email_payload: string | null;
    }>();
}
it('emails the invitation once with the inviter, Seattle description, and separate immutable issuance time', async () => {
  expect((await create()).status).toBe(201);
  const invitation = (await row())!;
  expect(sent).toHaveLength(1);
  expect(sent[0].body.to).toEqual(['friend@example.com']);
  expect(sent[0].body.text).toContain('Alice Example (@alice) invited you');
  expect(sent[0].body.text).toContain(
    'Seattle-based social media application for sharing photos with friends',
  );
  expect(sent[0].body.text).toContain('http://localhost:8787/');
  expect(sent[0].body.text).not.toContain('/magic-link/verify');
  expect(sent[0].body.text).toContain('/join#');
  expect(sent[0].body.text).toContain('No second email or password is needed');
  expect(invitation.email_sent_at).toBeGreaterThanOrEqual(
    invitation.created_at,
  );
  expect(invitation.email_attempted_at).toBeGreaterThanOrEqual(
    invitation.created_at,
  );
  expect(invitation.email_payload).toBeNull();
  expect((await create()).status).toBe(200);
  expect(
    (
      await runtime.request(
        'alice',
        `/api/invitations/${invitation.id}/send`,
        'POST',
      )
    ).status,
  ).toBe(200);
  expect(sent).toHaveLength(1);
  expect((await row())!.created_at).toBe(invitation.created_at);
  const history = (await (
    await runtime.request('alice', '/api/invitations')
  ).json()) as { items: Record<string, unknown>[] };
  expect(history.items.find((item) => item.id === invitation.id)).toMatchObject(
    {
      sentAt: invitation.email_sent_at,
      attemptedAt: invitation.email_attempted_at,
    },
  );
  expect(history.items[0]).not.toHaveProperty('email_payload');
  expect(history.items[0]).not.toHaveProperty('join_token_hash');
});
it('sends more than five invitations per member in a day while keeping retries idempotent', async () => {
  const emails = Array.from({ length: 6 }, (_, i) => `friend-${i}@example.com`);
  const responses = await Promise.all(
    emails.map((email) =>
      runtime.request('bob', '/api/invitations', 'POST', { email }),
    ),
  );
  expect(responses.map((response) => response.status)).toEqual(
    emails.map(() => 201),
  );
  expect(sent).toHaveLength(6);
  const invitations = await runtime.db
    .prepare(
      "SELECT recipient_email,expires_at-created_at AS lifetime FROM invitation WHERE inviter_id='bob' ORDER BY recipient_email",
    )
    .all();
  expect(invitations.results).toEqual(
    emails.map((email) => ({
      recipient_email: email,
      lifetime: 7 * 86400000,
    })),
  );
  const first = await responses[0].json();
  const retry = await runtime.request('bob', '/api/invitations', 'POST', {
    email: ' Friend-0@Example.com ',
  });
  expect(retry.status).toBe(200);
  expect(await retry.json()).toEqual(first);
  expect(sent).toHaveLength(6);
});

it('keeps failed sends retryable with the same payload/key and prevents a duplicate send race', async () => {
  providerStatus = 503;
  expect((await create()).status).toBe(503);
  const invitation = (await row())!;
  expect(invitation.email_sent_at).toBeNull();
  expect(invitation.email_payload).not.toBeNull();
  const first = sent[0];
  expect(invitation.email_payload).not.toContain('friend@example.com');
  expect(invitation.email_payload).not.toContain(
    first.body.text.match(/\/join#([a-zA-Z0-9]+)/)![1],
  );
  expect((await create()).status).toBe(409);
  expect(sent).toHaveLength(1);
  await runtime.db
    .prepare('UPDATE invitation SET email_last_attempt_at=0 WHERE id=?')
    .bind(invitation.id)
    .run();
  await runtime.db
    .prepare(
      "UPDATE profile SET display_name='Changed name' WHERE user_id='alice'",
    )
    .run();
  providerStatus = 200;
  const responses = await Promise.all([create(), create()]);
  expect(responses.some((r) => r.status === 200)).toBe(true);
  expect(sent).toHaveLength(2);
  expect(sent[1]).toEqual(first);
  expect((await row())!.email_payload).toBeNull();
  const token = sent[1].body.text.match(/\/join#([a-zA-Z0-9]+)/)![1];
  const preview = await runtime.request(
    null,
    '/api/auth/invitation/preview',
    'POST',
    { token },
  );
  expect(await preview.json()).toMatchObject({
    status: 'ready',
    email: 'friend@example.com',
  });
  await runtime.db
    .prepare(
      "UPDATE profile SET display_name='Alice Example' WHERE user_id='alice'",
    )
    .run();
});

it('replaces a legacy unconfirmed email with an encrypted join email without changing issuance or first-attempt times', async () => {
  const now = Date.now();
  await runtime.db
    .prepare(
      `INSERT INTO invitation(id,inviter_id,recipient_email,created_at,expires_at,email_payload,email_attempted_at,email_last_attempt_at)
    VALUES('legacy','alice','friend@example.com',?,?,?, ?,0)`,
    )
    .bind(
      now - 120000,
      now + 86400000,
      JSON.stringify({ text: 'Legacy email without a credential' }),
      now - 60000,
    )
    .run();
  const response = await runtime.request(
    'alice',
    '/api/invitations/legacy/send',
    'POST',
  );
  expect(response.status).toBe(200);
  expect(sent).toHaveLength(1);
  expect(sent[0].key).toBe('invitation-join/legacy');
  const token = sent[0].body.text.match(/\/join#([a-zA-Z0-9]+)/)![1];
  expect(
    await (
      await runtime.request(null, '/api/auth/invitation/preview', 'POST', {
        token,
      })
    ).json(),
  ).toMatchObject({ status: 'ready' });
  expect(await row()).toMatchObject({
    created_at: now - 120000,
    email_attempted_at: now - 60000,
    email_payload: null,
  });
});

it('does not rotate a credential after its uncertain-delivery payload was discarded', async () => {
  providerStatus = 503;
  expect((await create()).status).toBe(503);
  const invitation = (await row())!;
  await runtime.db
    .prepare(
      'UPDATE invitation SET email_payload=NULL,email_last_attempt_at=0 WHERE id=?',
    )
    .bind(invitation.id)
    .run();
  providerStatus = 200;
  const response = await runtime.request(
    'alice',
    `/api/invitations/${invitation.id}/send`,
    'POST',
  );
  expect(response.status).toBe(409);
  expect(sent).toHaveLength(1);
});
it('enforces shared email budgets, inviter ownership, revocation, and the safe retry window', async () => {
  await runtime.db
    .prepare('INSERT INTO email_budget VALUES(?,80,?)')
    .bind(`day:${Math.floor(Date.now() / 86400000)}`, Date.now() + 86400000)
    .run();
  expect((await create()).status).toBe(429);
  expect(sent).toHaveLength(0);
  const invitation = (await row())!;
  expect(
    (
      await runtime.request(
        'bob',
        `/api/invitations/${invitation.id}/send`,
        'POST',
      )
    ).status,
  ).toBe(404);
  expect(
    (
      await runtime.request(
        null,
        `/api/invitations/${invitation.id}/send`,
        'POST',
      )
    ).status,
  ).toBe(401);
  await runtime.db
    .prepare(
      'UPDATE invitation SET email_attempted_at=?,email_last_attempt_at=0 WHERE id=?',
    )
    .bind(Date.now() - 24 * 3600000, invitation.id)
    .run();
  expect(
    (
      await runtime.request(
        'alice',
        `/api/invitations/${invitation.id}/send`,
        'POST',
      )
    ).status,
  ).toBe(409);
  await runtime.request('alice', `/api/invitations/${invitation.id}`, 'DELETE');
  expect(
    (
      await runtime.request(
        'alice',
        `/api/invitations/${invitation.id}/send`,
        'POST',
      )
    ).status,
  ).toBe(404);
  expect((await row())!.email_payload).toBeNull();
  expect(sent).toHaveLength(0);
});
