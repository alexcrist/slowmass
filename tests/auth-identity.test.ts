import { afterEach, expect, it } from 'vitest';
import { testRuntime } from './support/runtime';
import {
  canonicalEmail,
  emailIdentitySQL,
  resolveSignInEmail,
} from '../src/server/auth/email';
let runtime: Awaited<ReturnType<typeof testRuntime>>;
afterEach(async () => {
  await runtime?.worker.dispose();
});
it('indexes the same canonical identity as application matching and rejects duplicate accounts', async () => {
  runtime = await testRuntime();
  for (const email of [
    'F.i.r.s.t+tag@googlemail.com',
    'Some.One@gmail.com',
    'NAME@Example.com',
    'someone+tag@workspace.example',
  ]) {
    await runtime.db
      .prepare("UPDATE user SET email=? WHERE id='alice'")
      .bind(email)
      .run();
    expect(
      await runtime.db
        .prepare(
          `SELECT ${emailIdentitySQL} AS identity FROM user WHERE id='alice'`,
        )
        .first('identity'),
    ).toBe(canonicalEmail(email));
    expect(
      await resolveSignInEmail(
        runtime.db as unknown as D1Database,
        canonicalEmail(email),
      ),
    ).toBe(email);
  }
  await runtime.db
    .prepare(
      "UPDATE user SET email='same.person+old@gmail.com' WHERE id='alice'",
    )
    .run();
  await expect(
    runtime.db
      .prepare(
        "UPDATE user SET email='sameperson@googlemail.com' WHERE id='bob'",
      )
      .run(),
  ).rejects.toThrow();
  const plan = await runtime.db
    .prepare(
      `EXPLAIN QUERY PLAN SELECT email FROM user WHERE ${emailIdentitySQL}=? LIMIT 2`,
    )
    .bind('sameperson@gmail.com')
    .all();
  expect(JSON.stringify(plan.results)).toContain('user_email_identity');
});
