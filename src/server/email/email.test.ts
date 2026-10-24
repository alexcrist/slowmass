import { afterEach, expect, it, vi } from 'vitest';
import type { Env } from '../env';
import { encodeSubject, sendNotificationEmail } from './index';

// A budget table stand-in: every reservation succeeds unless `full` is set.
function env(full = false) {
  const statement = { bind: () => statement };
  return {
    APP_ORIGIN: 'https://slowmass.test',
    SES_ACCESS_KEY_ID: 'test-key',
    SES_SECRET_ACCESS_KEY: 'test-secret',
    EMAIL_FROM: 'test@example.com',
    DB: {
      prepare: () => statement,
      batch: async () => [
        { meta: { changes: 1 } },
        { meta: { changes: full ? 0 : 1 } },
      ],
    },
  } as unknown as Env;
}
const message = {
  to: 'a@example.com',
  subject: 'Subject',
  text: 'Text',
  unsubscribe: 'https://slowmass.test/api/unsubscribe/token',
};
afterEach(() => vi.unstubAllGlobals());

it.each([
  [new Response('{}'), 'sent'],
  [new Response('{}', { status: 400 }), 'rejected'],
  [new Error('timeout'), 'unknown'],
] as const)(
  'reports a notification send as definite or ambiguous',
  async (outcome, result) => {
    const fetch = vi.fn(async (request: Request) => {
      const body = (await request.json()) as {
        Destination: unknown;
        Content: { Simple: { Headers: { Name: string; Value: string }[] } };
      };
      expect(body.Destination).toEqual({ ToAddresses: ['a@example.com'] });
      expect(body.Content.Simple.Headers).toEqual([
        {
          Name: 'List-Unsubscribe',
          Value: '<https://slowmass.test/api/unsubscribe/token>',
        },
        { Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' },
      ]);
      if (outcome instanceof Error) throw outcome;
      return outcome;
    });
    vi.stubGlobal('fetch', fetch);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await sendNotificationEmail(env(), message)).toBe(result);
    expect(fetch).toHaveBeenCalledOnce();
  },
);

it('stops at the daily budget and rejects foreign unsubscribe links', async () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  expect(await sendNotificationEmail(env(true), message)).toBe('throttled');
  await expect(
    sendNotificationEmail(env(), {
      ...message,
      unsubscribe: 'https://elsewhere.test/api/unsubscribe/token',
    }),
  ).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
});

it('encodes non-ASCII subjects as short RFC 2047 words', () => {
  expect(encodeSubject('Update from Ana:  Dinner')).toBe(
    'Update from Ana: Dinner',
  );
  const encoded = encodeSubject(`Update from Zoë: ${'🎉'.repeat(20)}`);
  expect(encoded).toMatch(/^[\x20-\x7e]+$/);
  const words = encoded.split(' ');
  expect(
    words.every((word) => /^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/.test(word)),
  ).toBe(true);
  expect(words.every((word) => word.length <= 75)).toBe(true);
  const decoded = words
    .map((word) =>
      new TextDecoder().decode(
        Uint8Array.from(atob(word.slice(10, -2)), (c) => c.charCodeAt(0)),
      ),
    )
    .join('');
  expect(decoded).toBe(`Update from Zoë: ${'🎉'.repeat(20)}`);
});
