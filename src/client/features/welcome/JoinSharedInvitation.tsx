import { useEffect, useState, type FormEvent } from 'react';
import { createAuthClient } from 'better-auth/react';
import { magicLinkClient } from 'better-auth/client/plugins';
import { api, jsonRequest } from '../../api';
import { PasteLoginLink } from './PasteLoginLink';
const auth = createAuthClient({ plugins: [magicLinkClient()] });
type Preview =
  | {
      status: 'ready';
      expiresAt: number;
      inviter: { name: string; handle: string };
      signedIn: boolean;
    }
  | { status: 'unavailable' };
export function JoinSharedInvitation() {
  const [token] = useState(() => location.hash.slice(1));
  const [preview, setPreview] = useState<Preview | null>(() =>
      /^[a-zA-Z0-9]{48}$/.test(token) ? null : { status: 'unavailable' },
    ),
    [error, setError] = useState(''),
    [attempt, setAttempt] = useState(0);
  const [email, setEmail] = useState(''),
    [busy, setBusy] = useState(false),
    [sent, setSent] = useState(false);
  useEffect(() => {
    if (!/^[a-zA-Z0-9]{48}$/.test(token)) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
      setError('This invitation took too long to load. Try again.');
    }, 15000);
    void api<Preview>('/api/auth/shared-invitation/preview', {
      ...jsonRequest('POST', { token }),
      signal: controller.signal,
    })
      .then((value) => {
        if (!controller.signal.aborted) setPreview(value);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError('Could not load this invitation. Try again.');
      })
      .finally(() => clearTimeout(timeout));
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [token, attempt]);
  async function join(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await auth.signIn.magicLink({
        email: email.trim().toLowerCase(),
        callbackURL: '/',
        errorCallbackURL: '/?error=invite',
        metadata: { inviteLink: token },
      });
      if (result.error) {
        setError(
          result.error.code === 'INVITATION_REQUIRED'
            ? 'This invite link is no longer available. Ask your friend for a new link.'
            : 'Could not send the verification email. Wait a minute and try again.',
        );
        return;
      }
      setSent(true);
    } catch {
      setError(
        'Could not send the verification email. Wait a minute and try again.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className={`welcome guest-shell${!preview ? ' startup-shell' : ''}`}>
      <header className="masthead">
        <a className="site-name" href="/" aria-label="slowmass home">
          slowmass
        </a>
      </header>
      <section className="account-section" aria-label="Shared invitation">
        {!preview ? (
          <>
            {!error && <p role="status">Loading invitation…</p>}
            {error && (
              <button
                onClick={() => {
                  setError('');
                  setAttempt((value) => value + 1);
                }}
              >
                Try again
              </button>
            )}
          </>
        ) : preview.status === 'unavailable' ? (
          <>
            <h1>This invite link is no longer available</h1>
            <p>
              It may have expired or been replaced. Ask your friend for a new
              link.
            </p>
            <a href="/">Already a member? Sign in</a>
          </>
        ) : preview.signedIn ? (
          <>
            <h1>You’re already signed in</h1>
            <p>Your account and existing invitation history stay the same.</p>
            <a href="/">Open slowmass</a>
          </>
        ) : sent ? (
          <>
            <h1>Check your email</h1>
            <p>
              Open the verification link sent to {email.trim().toLowerCase()} to
              join. You can join when verification succeeds, if this invite link
              is still active.
            </p>
            <p>The email link expires in 10 minutes.</p>
            <a href="/">Open slowmass after verifying</a>
            <button className="text-button" onClick={() => setSent(false)}>
              Use another email or try again
            </button>
            <PasteLoginLink />
          </>
        ) : (
          <>
            <h1>Join slowmass</h1>
            <p>
              {preview.inviter.name} (@{preview.inviter.handle}) invited you to
              join.
            </p>
            <p>
              Verify your email, then choose a username and add a profile photo.
              You can request to follow your friend once you’ve joined; this
              link does not give anyone access to private photos.
            </p>
            <form onSubmit={(event) => void join(event)}>
              <label className="field-label" htmlFor="shared-invite-email">
                Your email
              </label>
              <input
                id="shared-invite-email"
                type="email"
                autoComplete="email"
                required
                maxLength={254}
                value={email}
                disabled={busy}
                onChange={(event) => setEmail(event.target.value)}
              />
              <button className="primary-button" disabled={busy}>
                {busy ? 'Sending…' : 'Send verification email'}
              </button>
            </form>
            <a href="/">Already a member? Sign in</a>
          </>
        )}
        {error && <p role="alert">{error}</p>}
      </section>
    </main>
  );
}
