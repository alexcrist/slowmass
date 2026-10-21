import { signInRecoveryPath } from '../../../shared/sign-in';

/** Restrict pasted links to the existing same-origin verification endpoint. */
export function loginLinkTarget(input: string, origin: string): string | null {
  if (input.length > 4096) return null;
  try {
    const url = new URL(input.trim());
    if (
      url.origin !== origin ||
      !['https:', 'http:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== '/api/auth/magic-link/verify'
    )
      return null;
    const tokens = url.searchParams.getAll('token');
    if (
      tokens.length !== 1 ||
      !tokens[0] ||
      tokens[0].length > 512 ||
      /\s/.test(tokens[0])
    )
      return null;
    const target = new URL('/api/auth/magic-link/verify', origin);
    target.searchParams.set('token', tokens[0]);
    target.searchParams.set('callbackURL', '/');
    target.searchParams.set(
      'errorCallbackURL',
      signInRecoveryPath(url.searchParams.get('errorCallbackURL'), origin),
    );
    return target.href;
  } catch {
    return null;
  }
}
