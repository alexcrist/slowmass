import { expect, it } from 'vitest';
import { loginLinkTarget } from './login-link';
const origin = 'https://slowmass.com';
it.each(['invite', 'event'])(
  'preserves a %s invitation for failed pasted-link recovery',
  (kind) => {
    const link = new URL('/api/auth/magic-link/verify?token=synthetic', origin);
    const hash = `#${kind}/${'b'.repeat(48)}`;
    link.searchParams.set('errorCallbackURL', `/?error=signin${hash}`);
    const target = new URL(loginLinkTarget(link.href, origin)!);
    expect(target.searchParams.get('errorCallbackURL')).toBe(
      `/?error=signin${hash}`,
    );
    expect(target.searchParams.get('callbackURL')).toBe('/');
  },
);
it.each([
  `https://elsewhere.example/#invite/${'b'.repeat(48)}`,
  `https://person@slowmass.com/#invite/${'b'.repeat(48)}`,
  `https://slowmass.com/api/account#invite/${'b'.repeat(48)}`,
  '/?email=private@example.com#invite/short',
  `/#unrecognized/${'b'.repeat(48)}`,
])('drops unsafe recovery callbacks: %s', (callback) => {
  const link = new URL('/api/auth/magic-link/verify?token=synthetic', origin);
  link.searchParams.set('errorCallbackURL', callback);
  const target = new URL(loginLinkTarget(link.href, origin)!);
  expect(target.searchParams.get('errorCallbackURL')).toBe('/?error=signin');
});
it('keeps only the login token and forces local success and error destinations', () => {
  const result = new URL(
    loginLinkTarget(
      ' https://slowmass.com/api/auth/magic-link/verify?token=synthetic-token&callbackURL=https://example.com&newUserCallbackURL=https://example.com#ignored ',
      origin,
    )!,
  );
  expect(result.origin).toBe(origin);
  expect(result.pathname).toBe('/api/auth/magic-link/verify');
  expect([...result.searchParams]).toEqual([
    ['token', 'synthetic-token'],
    ['callbackURL', '/'],
    ['errorCallbackURL', '/?error=signin'],
  ]);
  expect(result.hash).toBe('');
});
it.each([
  'https://example.com/api/auth/magic-link/verify?token=test',
  'https://slowmass.com.evil.test/api/auth/magic-link/verify?token=test',
  'http://slowmass.com/api/auth/magic-link/verify?token=test',
  'https://person@slowmass.com/api/auth/magic-link/verify?token=test',
  'https://slowmass.com/api/posts?token=test',
  'https://slowmass.com/api/auth/magic-link/verify',
  'https://slowmass.com/api/auth/magic-link/verify?token=',
  'https://slowmass.com/api/auth/magic-link/verify?token=a&token=b',
  'https://slowmass.com/api/auth/magic-link/verify?token=%20',
  'https://slowmass.com/api/auth/magic-link/verify?token=' + 'a'.repeat(513),
  'javascript:alert(1)',
  '/api/auth/magic-link/verify?token=test',
  'x'.repeat(4097),
])('rejects an unsafe or malformed pasted link: %s', (link) => {
  expect(loginLinkTarget(link, origin)).toBeNull();
});
