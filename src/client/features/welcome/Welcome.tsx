import { useEffect, useState, type FormEvent } from 'react';
import { createAuthClient } from 'better-auth/react';
import { magicLinkClient } from 'better-auth/client/plugins';
import { PasteLoginLink } from './PasteLoginLink';
import { MemberApp } from '../people/MemberApp';

const auth = createAuthClient({ plugins: [magicLinkClient()] });
type State = 'loading' | 'ready' | 'unavailable' | 'error';

export function Welcome() {
  const [state, setState] = useState<State>('loading');
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [message, setMessage] = useState(() =>
    new URLSearchParams(location.search).has('error')
      ? 'That sign-in link could not be used. It may have expired, been used already, or your invitation may no longer be active. Request a new link below.'
      : '',
  );
  const [checking, setChecking] = useState(false);
  const [loginStatus, setLoginStatus] = useState('');
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
        if (controller.signal.aborted) return;
        if (status.signInAvailable) {
          const me = await fetch('/api/me', { signal: controller.signal });
          if (me.ok) {
            const result = (await me.json()) as { user: { name: string } };
            if (controller.signal.aborted) return;
            setName(result.user.name);
          } else if (me.status !== 401) {
            throw new Error('Account unavailable');
          }
        }
        if (!controller.signal.aborted)
          setState(status.signInAvailable ? 'ready' : 'unavailable');
      } catch {
        if (!controller.signal.aborted) setState('error');
      }
    }
    void load();
    return () => controller.abort();
  }, [attempt]);

  function retry() {
    setState('loading');
    setAttempt((value) => value + 1);
  }

  useEffect(() => {
    if (!sent || name !== null) return;
    const controller = new AbortController();
    const check = () => {
      if (document.visibilityState === 'hidden') return;
      fetch('/api/me', { signal: controller.signal })
        .then(async (response) => {
          if (response.ok) {
            const data = (await response.json()) as { user: { name: string } };
            if (!controller.signal.aborted) setName(data.user.name);
          }
        })
        .catch(() => {});
    };
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      controller.abort();
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, [sent, name]);
  async function checkLogin() {
    setChecking(true);
    setLoginStatus('');
    try {
      const response = await fetch('/api/me');
      if (response.ok) {
        const data = (await response.json()) as { user: { name: string } };
        setName(data.user.name);
      } else if (response.status === 401)
        setLoginStatus(
          'No sign-in found in this window yet. Open your email link, then return here.',
        );
      else throw new Error();
    } catch {
      setLoginStatus('Could not check sign-in. Please try again.');
    } finally {
      setChecking(false);
    }
  }
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
    <main
      className={`welcome ${name !== null ? 'member-shell' : 'guest-shell'}`}
    >
      <header className="masthead">
        <a className="site-name" href="/" aria-label="Slowmass home">
          slowmass
        </a>
      </header>
      <section
        className="account-section"
        aria-label={
          state !== 'ready'
            ? 'Slowmass'
            : name !== null
              ? 'Your account'
              : 'Sign in'
        }
      >
        {state === 'ready' && name === null && (
          <>
            <h1>Welcome to Slowmass</h1>
            <p className="status-copy">
              Sign in or join with the email address your friend invited.
            </p>
          </>
        )}
        <div className="sign-in-area">
          {state === 'loading' ? (
            <p role="status">Loading Slowmass…</p>
          ) : state === 'error' || state === 'unavailable' ? (
            <div>
              <p role="alert">
                {state === 'error'
                  ? 'We couldn’t load Slowmass. Check your connection and try again.'
                  : 'Slowmass is temporarily unavailable. Please try again.'}
              </p>
              <button onClick={retry}>Try again</button>
            </div>
          ) : name !== null ? (
            <MemberApp onSignOut={() => void signOut()} signingOut={busy} />
          ) : sent ? (
            <div>
              <h2>Check your email</h2>
              <p className="status-copy">
                We’ve requested a link for {email.trim().toLowerCase()}. If
                you’re already a member or have an active invitation for this
                address, it will arrive shortly. The link works once and expires
                in 10 minutes.
              </p>
              <button
                className="primary-button"
                onClick={() => void checkLogin()}
                disabled={checking}
              >
                {checking ? 'Checking…' : 'I’ve opened the email link'}
              </button>
              {loginStatus && <p role="status">{loginStatus}</p>}
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
              <button className="primary-button" type="submit" disabled={busy}>
                {busy ? 'Requesting your link…' : 'Send sign-in link'}
              </button>
              <p className="status-copy">
                New here? Ask a member to invite you. No password is needed.
              </p>
            </form>
          )}
          {name === null && state === 'ready' && <PasteLoginLink />}
          {state === 'ready' && message && (
            <p className="error-message" role="alert">
              {message}
            </p>
          )}
        </div>
      </section>
    </main>
  );
}
