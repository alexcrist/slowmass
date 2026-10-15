import { JoinSharedInvitation } from './JoinSharedInvitation';
import { useEffect, useLayoutEffect, useState, type FormEvent } from 'react';
import { createAuthClient } from 'better-auth/react';
import { magicLinkClient } from 'better-auth/client/plugins';
import { PasteLoginLink } from './PasteLoginLink';
import { MemberApp } from '../people';
import { JoinInvitation } from './JoinInvitation';
import { onUnauthorized } from '../../api';
import { clearLocalPush } from '../push';
import { loadStartup, type Bootstrap } from './startup';

const auth = createAuthClient({ plugins: [magicLinkClient()] });
type State = 'loading' | 'ready' | 'unavailable' | 'error';

export function Welcome() {
  return location.pathname === '/invite' ? (
    <JoinSharedInvitation />
  ) : location.pathname === '/join' ? (
    <JoinInvitation />
  ) : (
    <AccountWelcome />
  );
}

function AccountWelcome() {
  const [state, setState] = useState<State>('loading');
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [message, setMessage] = useState(() =>
    new URLSearchParams(location.search).get('error') === 'invite'
      ? 'This invitation could not be used. It may have expired, been replaced, or been revoked before verification. Ask your friend for a new invite link, or sign in if you already joined.'
      : new URLSearchParams(location.search).has('error')
        ? 'That sign-in link could not be used. It may have expired, been used already, or your invitation may no longer be active. Request a new link below.'
        : '',
  );
  const [checking, setChecking] = useState(false);
  const [loginStatus, setLoginStatus] = useState('');
  const [member, setMember] = useState<Bootstrap | null>(null);
  const name = member?.user?.name ?? null;
  const memberId = member?.user?.id;

  // Register before member screens start passive effects and API requests.
  useLayoutEffect(() => {
    if (!memberId) return;
    return onUnauthorized(() => {
      setMember(null);
      setSent(false);
      setMessage('Your session has expired. Sign in again to continue.');
    });
  }, [memberId]);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const status = await loadStartup(controller.signal);
        if (controller.signal.aborted) return;
        setMember(status.user ? status : null);
        if (!controller.signal.aborted)
          setState(status.signInAvailable ? 'ready' : 'unavailable');
      } catch {
        if (!controller.signal.aborted) setState('error');
      }
    }
    void load();
    return () => {
      controller.abort();
    };
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
      fetch('/api/bootstrap', { signal: controller.signal })
        .then(async (response) => {
          if (response.ok) {
            const data = (await response.json()) as Bootstrap;
            if (!controller.signal.aborted && data.user) setMember(data);
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
      const response = await fetch('/api/bootstrap');
      if (response.ok) {
        const data = (await response.json()) as Bootstrap;
        if (!data.signInAvailable) throw new Error();
        if (data.user) setMember(data);
        else
          setLoginStatus(
            'No sign-in found in this window yet. Open your email link, then return here.',
          );
      } else throw new Error();
    } catch {
      setLoginStatus('Could not check sign-in. Please try again.');
    } finally {
      setChecking(false);
    }
  }
  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      const result = await auth.signIn.magicLink({
        email: email.trim().toLowerCase(),
        callbackURL: '/',
        errorCallbackURL: '/?error=signin',
      });
      if (result.error?.code === 'INVITATION_REQUIRED') {
        setMessage(
          'You need an invitation from a slowmass member to join. Ask them to invite this email address, then try again.',
        );
        return;
      }
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
      void clearLocalPush().catch(() => {});
      setMember(null);
      setSent(false);
    } catch {
      setMessage('Sign-out could not be completed. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main
      className={`welcome ${name !== null ? 'member-shell' : 'guest-shell'}${state !== 'ready' ? ' startup-shell' : ''}`}
    >
      <header className="masthead">
        <a className="site-name" href="/" aria-label="slowmass home">
          slowmass
        </a>
      </header>
      <section
        className="account-section"
        aria-label={
          state !== 'ready'
            ? 'slowmass'
            : name !== null
              ? 'Your account'
              : 'Sign in'
        }
      >
        {state === 'ready' && name === null && (
          <>
            <h1>Welcome to slowmass</h1>
            <p className="status-copy">
              Sign in or join with the email address your friend invited.
            </p>
          </>
        )}
        <div className="sign-in-area">
          {state === 'loading' ? (
            <p role="status">Loading slowmass…</p>
          ) : state === 'error' || state === 'unavailable' ? (
            <div>
              <p role="alert">
                {state === 'error'
                  ? 'We couldn’t load slowmass. Please try again.'
                  : 'slowmass is temporarily unavailable. Please try again.'}
              </p>
              <button onClick={retry}>Try again</button>
            </div>
          ) : member?.user ? (
            <MemberApp
              key={member.user.id}
              initialProfile={member.profile}
              deviceSetupPending={member.deviceSetupPending}
              onSignOut={() => void signOut()}
              signingOut={busy}
            />
          ) : sent ? (
            <div>
              <h2>Check your email</h2>
              <p className="status-copy">
                We’ve requested a sign-in link for {email.trim().toLowerCase()}.
                Check your inbox and spam folder. The link works once and
                expires in 10 minutes.
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
