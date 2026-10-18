import { useEffect, useLayoutEffect, useState, type FormEvent } from 'react';
import { createAuthClient } from 'better-auth/react';
import { magicLinkClient } from 'better-auth/client/plugins';
import { PasteLoginLink } from './PasteLoginLink';
import { MemberApp } from '../people';
import { api, jsonRequest, onUnauthorized } from '../../api';
import { clearLocalPush } from '../push';
import { loadStartup, type Bootstrap } from './startup';

const auth = createAuthClient({ plugins: [magicLinkClient()] });
type State = 'loading' | 'ready' | 'unavailable' | 'error';

// An event's URL is the only invitation. Signed out, it reveals only whether it
// works; signing in through it shows the event and admits new people.
type LinkEvent = { id: string; open: boolean } | null;

export function Welcome() {
  const [state, setState] = useState<State>('loading');
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [message, setMessage] = useState(() =>
    new URLSearchParams(location.search).get('error') === 'event'
      ? 'That sign-in link could not be used for this event. It may be over or cancelled, or its link may no longer work.'
      : new URLSearchParams(location.search).has('error')
        ? 'That sign-in link could not be used. It may have expired or been used already. Request a new link below.'
        : '',
  );
  const [eventToken] = useState(
    () => /^#event\/([a-zA-Z0-9]{48})$/.exec(location.hash)?.[1] ?? null,
  );
  const [linkEvent, setLinkEvent] = useState<LinkEvent | undefined>();
  const [linkAttempt, setLinkAttempt] = useState(0);
  const [linkError, setLinkError] = useState(false);
  const [checking, setChecking] = useState(false);
  const [loginStatus, setLoginStatus] = useState('');
  const [member, setMember] = useState<Bootstrap | null>(null);
  // Member screens place their header controls here.
  const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null);
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
  const signedOut = state === 'ready' && member === null;
  useEffect(() => {
    if (!signedOut || !eventToken) return;
    const controller = new AbortController();
    api<{ event: LinkEvent }>('/api/event-link', {
      ...jsonRequest('POST', { token: eventToken }),
      signal: controller.signal,
    })
      .then((result) => setLinkEvent(result.event))
      .catch(() => {
        if (!controller.signal.aborted) setLinkError(true);
      });
    return () => controller.abort();
  }, [signedOut, eventToken, linkAttempt]);
  // A working event link signs in through that event; otherwise sign in normally.
  const event = eventToken && linkEvent ? linkEvent : null;
  async function signIn(submit: FormEvent<HTMLFormElement>) {
    submit.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      const result = await auth.signIn.magicLink({
        email: email.trim().toLowerCase(),
        ...(event
          ? {
              callbackURL: `/#event/${event.id}`,
              errorCallbackURL: '/?error=event',
              metadata: { eventLink: eventToken },
            }
          : { callbackURL: '/', errorCallbackURL: '/?error=signin' }),
      });
      if (result.error?.code === 'INVITATION_REQUIRED') {
        setMessage(
          event
            ? 'This event isn’t taking new people. If you already use slowmass, use that email; otherwise ask the host for the current link.'
            : 'There’s no slowmass account for this email. To join, ask a member to text you an event link.',
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
        <div className="masthead-actions" ref={setHeaderSlot} />
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
        {state === 'ready' &&
          name === null &&
          (eventToken && linkEvent !== null ? (
            <>
              <h1>You’re invited to an event</h1>
              <p className="status-copy">
                {linkEvent?.open === false
                  ? 'This event is over or was cancelled. If you already use slowmass, sign in to see it.'
                  : 'Enter your email to see it. We’ll send a sign-in link; if you’re new, this creates your slowmass account.'}
              </p>
            </>
          ) : (
            <>
              <h1>Welcome to slowmass</h1>
              <p className="status-copy">
                {eventToken
                  ? 'This event link isn’t available. The event may have ended, or the link may no longer work.'
                  : 'Sign in with your email. New here? Ask a member to text you an event link.'}
              </p>
            </>
          ))}
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
              deviceSetup={{
                pending: member.deviceSetupPending === true,
                pushSubscribed: member.pushSubscribed === true,
              }}
              headerSlot={headerSlot}
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
          ) : eventToken && linkEvent === undefined ? (
            linkError ? (
              <div>
                <p role="alert">Could not check this event link.</p>
                <button
                  onClick={() => {
                    setLinkError(false);
                    setLinkAttempt((value) => value + 1);
                  }}
                >
                  Try again
                </button>
              </div>
            ) : (
              <p role="status">Checking this event link…</p>
            )
          ) : (
            <form onSubmit={(submit) => void signIn(submit)}>
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
              <p className="status-copy">No password is needed.</p>
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
