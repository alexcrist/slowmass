export const SIGN_IN_LINK_HOURS = 4;
export const SIGN_IN_LINK_SECONDS = SIGN_IN_LINK_HOURS * 60 * 60;

/** Rebuild a local recovery destination, keeping only a known invitation. */
export function signInRecoveryPath(
  callback: string | null,
  origin: string,
): string {
  const fallback = '/?error=signin';
  if (!callback) return fallback;
  try {
    const recovery = new URL(callback, origin);
    if (
      recovery.origin !== origin ||
      recovery.username ||
      recovery.password ||
      recovery.pathname !== '/'
    )
      return fallback;
    const error = recovery.searchParams.get('error');
    const path =
      error === 'event' || error === 'invite' ? `/?error=${error}` : fallback;
    return (
      path +
      (/^#(event|invite)\/[a-zA-Z0-9]{48}$/.test(recovery.hash)
        ? recovery.hash
        : '')
    );
  } catch {
    return fallback;
  }
}
