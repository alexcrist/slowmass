import { expect, it } from 'vitest';
import { makeSignature } from 'better-auth/crypto';
import { betterAuth } from 'better-auth';
import { authOptions } from '../src/server/auth/options';
import { getActiveSession } from '../src/server/auth';
import {
  measuredDatabase,
  requestMetrics,
  emptyMetrics,
} from '../src/server/telemetry';
import { testRuntime, seedProfilePhotos } from './support/runtime';
import type { Env } from '../src/server/env';

it('joins auth reads and checks current membership/completion without caching revocation', async () => {
  const runtime = await testRuntime();
  try {
    await runtime.request('alice', '/api/people/self', 'PUT', {
      handle: 'alice',
      displayName: 'Alice',
      bio: '',
    });
    await seedProfilePhotos(runtime.db);
    const secret = 'test-only-secret-with-at-least-thirty-two-characters';
    const env = {
      DB: measuredDatabase(runtime.db as unknown as D1Database),
      AUTH_SECRET: secret,
      APP_ORIGIN: 'http://localhost:8787',
      SES_ACCESS_KEY_ID: 'test-key',
      SES_SECRET_ACCESS_KEY: 'test-secret',
      EMAIL_FROM: 'test@example.com',
    } as Env;
    const token = 'alice-token';
    const headers = new Headers({
      Cookie: `better-auth.session_token=${encodeURIComponent(`${token}.${await makeSignature(token, secret)}`)}`,
    });
    const options = authOptions(env);
    const legacy = betterAuth({
      ...options,
      advanced: {
        ...options.advanced,
        database: { ...options.advanced?.database, joins: false },
      },
    });
    const old = emptyMetrics();
    // Compare reads only; ordinary requests no longer renew sessions.
    await requestMetrics.run(old, () =>
      legacy.api.getSession({ headers, query: { disableRefresh: true } }),
    );
    expect(old.queries).toBe(2);
    const joined = emptyMetrics();
    const session = await requestMetrics.run(joined, () =>
      getActiveSession(env, headers),
    );
    expect(session).toMatchObject({
      user: { id: 'alice' },
      hasProfilePhoto: true,
    });
    // One native session/user join plus one membership/completion query.
    expect(joined.queries).toBe(2);
    expect(joined.sessionStage).toBe('lookup');
    const invalid = emptyMetrics();
    expect(
      await requestMetrics.run(invalid, () =>
        getActiveSession(
          env,
          new Headers({ Cookie: 'better-auth.session_token=invalid' }),
        ),
      ),
    ).toBeNull();
    expect(invalid.sessionStage).toBe('endpoint');
    expect(invalid.queries).toBe(0);
    await runtime.db.prepare("DELETE FROM avatar WHERE user_id='alice'").run();
    expect(await getActiveSession(env, headers)).toMatchObject({
      hasProfilePhoto: false,
    });
    await runtime.db
      .prepare("UPDATE membership SET status='disabled' WHERE user_id='alice'")
      .run();
    expect(await getActiveSession(env, headers)).toBeNull();
    await runtime.db
      .prepare("UPDATE membership SET status='active' WHERE user_id='alice'")
      .run();
    await runtime.db
      .prepare(
        "UPDATE session SET expiresAt='2020-01-01T00:00:00.000Z' WHERE userId='alice'",
      )
      .run();
    expect(await getActiveSession(env, headers)).toBeNull();
  } finally {
    await runtime.worker.dispose();
  }
});
