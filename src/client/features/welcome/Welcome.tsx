import { useEffect, useState, type FormEvent } from 'react';
import { createAuthClient } from 'better-auth/react';
import { magicLinkClient } from 'better-auth/client/plugins';
import { MemberApp } from '../people/MemberApp';

const auth = createAuthClient({ plugins: [magicLinkClient()] });
type State = 'loading' | 'ready' | 'unavailable' | 'error';

export function Welcome() {
  const [state, setState] = useState<State>('loading');
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [message, setMessage] = useState(() =>
    new URLSearchParams(location.search).has('error')
      ? 'That sign-in link could not be used. It may have expired, been used already, or your invitation may no longer be active. Request a new link below.'
      : '',
  );
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch('/api/status', {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('Status unavailable');
        const status = (await response.json()) as { signInAvailable: boolean };
        setState(status.signInAvailable ? 'ready' : 'unavailable');
        if (status.signInAvailable) {
          const me = await fetch('/api/me', { signal: controller.signal });
          if (me.ok) {
            const result = (await me.json()) as { user: { name: string } };
            setName(result.user.name);
          } else if (me.status !== 401) {
            throw new Error('Account unavailable');
          }
        }
      } catch {
        if (!controller.signal.aborted) setState('error');
      }
    }
    void load();
    return () => controller.abort();
  }, []);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const result = await auth.signIn.magicLink({
        email: email.trim().toLowerCase(),
        callbackURL: '/',
        errorCallbackURL: '/?error=signin',
      });
      if (result.error) throw new Error('Sign-in failed');
      setSent(true);
    } catch {
      setMessage(
        'We couldn’t request a sign-in link. Wait a minute and try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    try {
      const result = await auth.signOut();
      if (result.error) throw new Error('Sign-out failed');
      setName(null);
      setSent(false);
    } catch {
      setMessage('Sign-out could not be completed. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="welcome">
      <header className="masthead">
        <a className="site-name" href="/" aria-label="Slowmass home">
          Slowmass
        </a>
      </header>
      <section className="account-section" aria-labelledby="welcome-title">
        <h1 id="welcome-title">{name !== null ? 'Account' : 'Sign in'}</h1>
        <div className="sign-in-area">
          {name !== null ? (
            <>
              <p className="signed-in">
                {name ? `Welcome, ${name}.` : 'You’re signed in.'}
              </p>
              <MemberApp />
              <button
                className="text-button"
                onClick={() => void signOut()}
                disabled={busy}
              >
                {busy ? 'Signing out…' : 'Sign out'}
              </button>
            </>
          ) : sent ? (
            <div role="status">
              <h2>Check your email.</h2>
              <p className="status-copy">
                If you’re a member or have an active invitation, a sign-in link
                will arrive shortly. The link works once and expires in 10
                minutes.
              </p>
              <button className="text-button" onClick={() => setSent(false)}>
                Use another email or try again
              </button>
            </div>
          ) : (
            <form onSubmit={(event) => void signIn(event)}>
              <label className="field-label" htmlFor="email">
                Your email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                maxLength={254}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                disabled={busy}
              />
              <button
                className="primary-button"
                type="submit"
                disabled={state !== 'ready' || busy}
              >
                {busy
                  ? 'Requesting your link…'
                  : state === 'loading'
                    ? 'One moment…'
                    : 'Email me a sign-in link'}
              </button>
              <p className="status-copy">
                {state === 'unavailable'
                  ? 'Sign-in is not available yet.'
                  : state === 'error'
                    ? 'We couldn’t connect. Refresh the page to try again.'
                    : 'Sign in by email. An invitation from an active member is required to join.'}
              </p>
            </form>
          )}
          {message && (
            <p className="error-message" role="alert">
              {message}
            </p>
          )}
        </div>
      </section>
    </main>
  );
}
