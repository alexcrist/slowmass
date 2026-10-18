import { useEffect, useLayoutEffect, useState, type FormEvent } from 'react';
import { createAuthClient } from 'better-auth/react';
import { magicLinkClient } from 'better-auth/client/plugins';
import { PasteLoginLink } from './PasteLoginLink';
import { MemberApp } from '../people';
import { EventPreview, type EventPreviewDetails } from '../events';
import { api, jsonRequest, onUnauthorized } from '../../api';
import { clearLocalPush } from '../push';
import { loadStartup, type Bootstrap } from './startup';

const auth = createAuthClient({ plugins: [magicLinkClient()] });
type State = 'loading' | 'ready' | 'unavailable' | 'error';

// Invite and event links carry their credential in the URL fragment. Signed
// out, event links show a limited preview before asking for an email.
type Link = { kind: 'event' | 'invite'; token: string };
// A working link: whether it admits new people, and an event link's event.
type LinkCheck = {
  open: boolean;
  eventId?: string;
  preview?: EventPreviewDetails;
} | null;

// Members don't need an invite: drop its credential before member routes read
// the address.
function signedIn(data: Bootstrap) {
  if (location.hash.startsWith('#invite/'))
    window.history?.replaceState(
      window.history.state,
      '',
      location.pathname + location.search,
    );
  return data;
}

export function Welcome() {
  const [state, setState] = useState<State>('loading');
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [message, setMessage] = useState(() => {
    const error = new URLSearchParams(location.search).get('error');
    return error === 'event'
      ? 'That sign-in link could not be used for this event. It may be over or cancelled, or its link may no longer work.'
      : error === 'invite'
        ? 'That sign-in link could not be used to join. The invite link may have expired; ask your friend for a new one.'
        : error !== null
          ? 'That sign-in link could not be used. It may have expired or been used already. Request a new link below.'
          : '';
  });
  const [link] = useState<Link | null>(() => {
    const match = /^#(event|invite)\/([a-zA-Z0-9]{48})$/.exec(location.hash);
    return match
      ? { kind: match[1] === 'event' ? 'event' : 'invite', token: match[2] }
      : null;
  });
  const [checked, setChecked] = useState<LinkCheck | undefined>();
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
        setMember(status.user ? signedIn(status) : null);
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
            if (!controller.signal.aborted && data.user)
              setMember(signedIn(data));
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
        if (data.user) setMember(signedIn(data));
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
    if (!signedOut || !link) return;
    const controller = new AbortController();
    const request = {
      ...jsonRequest('POST', { token: link.token }),
      signal: controller.signal,
    };
    (link.kind === 'event'
      ? api<{
          event: {
            id: string;
            open: boolean;
            preview: EventPreviewDetails;
          } | null;
        }>('/api/event-link', request).then(
          ({ event }) =>
            event && {
              open: event.open,
              eventId: event.id,
              preview: event.preview,
            },
        )
      : api<{ available: boolean }>('/api/invite-link/check', request).then(
          ({ available }) => (available ? { open: true } : null),
        )
    )
      .then((result) => {
        if (!controller.signal.aborted) setChecked(result);
      })
      .catch(() => {
        if (!controller.signal.aborted) setLinkError(true);
      });
    return () => controller.abort();
  }, [signedOut, link, linkAttempt]);
  // A working link signs in through it; otherwise sign in normally.
  const working = link && checked ? { ...link, ...checked } : null;
  async function signIn(submit: FormEvent<HTMLFormElement>) {
    submit.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      const result = await auth.signIn.magicLink({
        email: email.trim().toLowerCase(),
        ...(working?.kind === 'event'
          ? {
              callbackURL: `/#event/${working.eventId}`,
              errorCallbackURL: '/?error=event',
              metadata: { eventLink: working.token },
            }
          : working?.kind === 'invite'
            ? {
                callbackURL: '/',
                errorCallbackURL: '/?error=invite',
                metadata: { inviteLink: working.token },
              }
            : { callbackURL: '/', errorCallbackURL: '/?error=signin' }),
      });
      if (result.error?.code === 'INVITATION_REQUIRED') {
        setMessage(
          working?.kind === 'event'
            ? 'This event isn’t taking new people. If you already use slowmass, use that email; otherwise ask the host for the current link.'
            : working?.kind === 'invite'
              ? 'This invite link isn’t taking new people anymore. If you already use slowmass, use that email; otherwise ask your friend for a new link.'
              : 'There’s no slowmass account for this email. To join, ask a member to text you an invite link.',
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
      className={`welcome ${name !== null ? 'member-shell' : 'guest-shell'}${state !== 'ready' ? ' startup-shell' : ''}${signedOut && checked?.preview ? ' event-preview-shell' : ''}`}
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
          (link?.kind === 'event' && checked !== null ? (
            <>
              {checked?.preview ? (
                <EventPreview
                  key={link.token}
                  token={link.token}
                  preview={checked.preview}
                />
              ) : (
                <h1>You’re invited to an event</h1>
              )}
              <div className="event-preview-intro">
                <p className="status-copy">
                  {checked?.open === false
                    ? 'This event isn’t taking new members. If you already use slowmass, sign in to see the details.'
                    : 'Enter your email to see details and RSVP.'}
                </p>
                {checked?.open && (
                  <p className="status-copy">
                    We’ll send a sign-in link. If you’re new, this creates your
                    slowmass account.
                  </p>
                )}
              </div>
            </>
          ) : link?.kind === 'invite' && checked !== null ? (
            <>
              <h1>You’re invited to slowmass</h1>
              <p className="status-copy">
                Enter your email to join. We’ll send a sign-in link; if you’re
                new, this creates your slowmass account.
              </p>
            </>
          ) : (
            <>
              <h1>Welcome to slowmass</h1>
              <p className="status-copy">
                {link?.kind === 'event'
                  ? 'This event link isn’t available. The event may have ended, or the link may no longer work.'
                  : link
                    ? 'This invite link isn’t available. It may have expired; ask your friend for a new one. Members can sign in below.'
                    : 'Sign in with your email. New here? Ask a member to text you an invite link.'}
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
          ) : link && checked === undefined ? (
            linkError ? (
              <div>
                <p role="alert">{`Could not check this ${link.kind} link.`}</p>
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
              <p role="status">{`Checking this ${link.kind} link…`}</p>
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
