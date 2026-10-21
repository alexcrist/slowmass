import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createAuthClient } from 'better-auth/react';
import { magicLinkClient } from 'better-auth/client/plugins';
import { PasteLoginLink } from './PasteLoginLink';
import { GoogleSignIn } from './GoogleSignIn';
import { LoginSubmit } from './LoginSubmit';
import { MemberApp } from '../people';
import { EventPreview, type EventPreviewDetails } from '../events';
import { api, jsonRequest, onUnauthorized } from '../../api';
import { clearLocalPush } from '../push';
import { loadStartup, type Bootstrap } from './startup';
import { currentRoute, normalizeEventPath } from '../../navigation';
import { SIGN_IN_LINK_HOURS } from '../../../shared/sign-in';

const auth = createAuthClient({ plugins: [magicLinkClient()] });
type State = 'loading' | 'ready' | 'unavailable' | 'error';

// Event paths support unfurling; old fragment links still work. Signed out,
// event links show a limited preview before asking for an email.
type Link = { kind: 'event' | 'invite'; token: string };
function currentLink(): Link | null {
  const match = /^(event|invite)\/([a-zA-Z0-9]{48})$/.exec(currentRoute());
  return match
    ? { kind: match[1] === 'event' ? 'event' : 'invite', token: match[2] }
    : null;
}
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
  const [googleAvailable, setGoogleAvailable] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const requestingGoogle = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const resumed = () => {
      if (!requestingGoogle.current) return;
      requestingGoogle.current = false;
      setBusy(false);
      setGoogleBusy(false);
    };
    window.addEventListener('pageshow', resumed);
    return () => {
      mounted.current = false;
      window.removeEventListener('pageshow', resumed);
    };
  }, []);
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [failedLink, setFailedLink] = useState(
    () =>
      new URLSearchParams(location.search).has('error') &&
      new URLSearchParams(location.search).get('auth') !== 'google',
  );
  const [message, setMessage] = useState(() => {
    const params = new URLSearchParams(location.search);
    const error = params.get('error');
    if (error !== null && params.get('auth') === 'google')
      return 'Google sign-in wasn’t completed. Try again or use an email link. New here? Open your invitation first.';
    return error === 'event'
      ? 'That sign-in link could not be used for this event. It may be over or cancelled, or its link may no longer work.'
      : error === 'invite'
        ? 'That sign-in link could not be used to join. The invite link may have expired; ask your friend for a new one.'
        : error !== null
          ? 'That sign-in link could not be used. It may have expired or been used already. Enter your email below to send a new link.'
          : '';
  });
  const [link, setLink] = useState<Link | null>(currentLink);
  const [checked, setChecked] = useState<LinkCheck | undefined>();
  const [linkAttempt, setLinkAttempt] = useState(0);
  const [linkError, setLinkError] = useState(false);
  const [checking, setChecking] = useState(false);
  const [loginError, setLoginError] = useState(false);
  const [loginAttempt, setLoginAttempt] = useState(0);
  const [resendStatus, setResendStatus] = useState('');
  const confirmationHeading = useRef<HTMLHeadingElement>(null);
  const requestingLink = useRef(false);
  const linkRevision = useRef(0);
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
        setGoogleAvailable(status.googleSignInAvailable === true);
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
    if (sent) confirmationHeading.current?.focus();
  }, [sent]);

  useEffect(() => {
    if (!sent || name !== null) return;
    const controller = new AbortController();
    let inFlight = false;
    const check = async () => {
      if (document.visibilityState === 'hidden' || inFlight) return;
      inFlight = true;
      setChecking(true);
      setLoginError(false);
      try {
        // Reuse startup's validated, bounded read and transient-failure retry.
        const data = await loadStartup(controller.signal);
        if (controller.signal.aborted) return;
        if (!data.signInAvailable) throw new Error('Sign-in unavailable');
        if (data.user) setMember(signedIn(data));
      } catch {
        if (!controller.signal.aborted) setLoginError(true);
      } finally {
        inFlight = false;
        if (!controller.signal.aborted) setChecking(false);
      }
    };
    const resume = () => void check();
    window.addEventListener('focus', resume);
    window.addEventListener('pageshow', resume);
    window.addEventListener('online', resume);
    document.addEventListener('visibilitychange', resume);
    if (loginAttempt > 0) resume();
    return () => {
      controller.abort();
      window.removeEventListener('focus', resume);
      window.removeEventListener('pageshow', resume);
      window.removeEventListener('online', resume);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [sent, name, loginAttempt]);
  const signedOut = state === 'ready' && member === null;
  useLayoutEffect(() => {
    if (!signedOut) return;
    const changed = () => {
      normalizeEventPath();
      const next = currentLink();
      if (next?.kind === link?.kind && next?.token === link?.token) return;
      linkRevision.current += 1;
      setLink(next);
      setChecked(undefined);
      setLinkError(false);
      setSent(false);
      setFailedLink(false);
      setMessage('');
      setResendStatus('');
    };
    changed();
    window.addEventListener('hashchange', changed);
    window.addEventListener('popstate', changed);
    return () => {
      window.removeEventListener('hashchange', changed);
      window.removeEventListener('popstate', changed);
    };
  }, [signedOut, link]);
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
  async function requestSignIn() {
    if (requestingLink.current || requestingGoogle.current) return;
    requestingLink.current = true;
    const revision = linkRevision.current;
    setBusy(true);
    setMessage('');
    setResendStatus('');
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
      // Navigation to another invitation must not show this request's
      // confirmation or let a resend silently switch the joining source.
      if (revision !== linkRevision.current) return;
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
      if (sent)
        setResendStatus(
          'New link requested. Check your email, including spam.',
        );
      else {
        setLoginError(false);
        setLoginAttempt(0);
      }
      setSent(true);
      setFailedLink(false);
    } catch {
      if (revision === linkRevision.current)
        setMessage(
          'We couldn’t request a sign-in link. Wait a minute and try again.',
        );
    } finally {
      requestingLink.current = false;
      setBusy(false);
    }
  }

  async function requestGoogleSignIn() {
    if (requestingGoogle.current || requestingLink.current) return;
    requestingGoogle.current = true;
    const revision = linkRevision.current;
    setBusy(true);
    setGoogleBusy(true);
    setMessage('');
    let redirecting = false;
    try {
      const result = await auth.signIn.social({
        provider: 'google',
        disableRedirect: true,
        ...(working
          ? {
              additionalData: {
                [working.kind === 'event' ? 'eventLink' : 'inviteLink']:
                  working.token,
              },
            }
          : {}),
      });
      if (!mounted.current || revision !== linkRevision.current) return;
      if (result.error || !result.data?.url)
        throw new Error('Google sign-in failed');
      // Only the auth library's Google authorization URL can leave this page.
      const destination = new URL(result.data.url);
      if (destination.origin !== 'https://accounts.google.com')
        throw new Error('Unexpected sign-in destination');
      location.assign(destination.href);
      redirecting = true;
    } catch {
      if (mounted.current && revision === linkRevision.current)
        setMessage(
          'Couldn’t start Google sign-in. Try again or use an email link. If your invitation expired, ask for a new link.',
        );
    } finally {
      if (!redirecting) requestingGoogle.current = false;
      if (mounted.current && !redirecting) {
        setBusy(false);
        setGoogleBusy(false);
      }
    }
  }

  async function signOut() {
    setBusy(true);
    setMessage('');
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
              {!sent && (
                <div className="event-preview-intro">
                  <p className="status-copy">
                    {checked?.open === false
                      ? 'This event isn’t taking new members. If you already use slowmass, sign in to see the details.'
                      : googleAvailable
                        ? 'Sign in to see details and RSVP.'
                        : 'Enter your email to see details and RSVP.'}
                  </p>
                  {checked?.open && !googleAvailable && (
                    <p className="status-copy">We’ll send a sign-in link.</p>
                  )}
                </div>
              )}
            </>
          ) : link?.kind === 'invite' && checked !== null ? (
            <>
              <h1>You’re invited to slowmass</h1>
              {!sent && (
                <p className="status-copy">
                  {googleAvailable
                    ? 'Choose how to sign in to join.'
                    : 'Enter your email to join. We’ll send a sign-in link.'}
                </p>
              )}
            </>
          ) : (
            <>
              <h1>Welcome to slowmass</h1>
              {!sent && (
                <p className="status-copy">
                  {link?.kind === 'event'
                    ? 'This event link isn’t available. The event may have ended, or the link may no longer work.'
                    : link
                      ? 'This invite link isn’t available. It may have expired; ask your friend for a new one. Members can sign in below.'
                      : googleAvailable
                        ? 'New here? Ask a member to text you an invite link.'
                        : 'Sign in with your email. New here? Ask a member to text you an invite link.'}
                </p>
              )}
            </>
          ))}
        <div className="sign-in-area">
          {state === 'ready' && message && (
            <p className="error-message" role="alert">
              {message}
            </p>
          )}
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
              <h2 ref={confirmationHeading} tabIndex={-1}>
                Open the sign-in link in your email.
              </h2>
              <p className="status-copy">
                Check <strong>{email.trim().toLowerCase()}</strong>, including
                spam. The link works once and expires in {SIGN_IN_LINK_HOURS}{' '}
                hours.
              </p>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => void requestSignIn()}
              >
                {busy ? 'Sending…' : 'Send a new link'}
              </button>
              {resendStatus && <p role="status">{resendStatus}</p>}
              {checking && <p role="status">Checking sign-in…</p>}
              {loginError && (
                <div>
                  <p className="error-message" role="alert">
                    Couldn’t check sign-in. Please try again.
                  </p>
                  <button
                    className="text-button"
                    onClick={() => setLoginAttempt((value) => value + 1)}
                  >
                    Try again
                  </button>
                </div>
              )}
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
            <>
              <form
                onSubmit={(submit) => {
                  submit.preventDefault();
                  void requestSignIn();
                }}
                aria-busy={busy}
              >
                <label className="field-label" htmlFor="email">
                  Your email
                </label>
                <div className={failedLink ? undefined : 'joined-field'}>
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
                  {!failedLink && (
                    <LoginSubmit
                      label={
                        busy && !googleBusy
                          ? 'Requesting your link…'
                          : 'Send sign-in link'
                      }
                      busy={busy}
                    />
                  )}
                </div>
                {failedLink && (
                  <button
                    type="submit"
                    className="primary-button"
                    disabled={busy}
                  >
                    {busy ? 'Sending…' : 'Send a new link'}
                  </button>
                )}
                {busy && !googleBusy && (
                  <p className="visually-hidden" role="status">
                    Requesting your link…
                  </p>
                )}
              </form>
              {googleAvailable && (
                <GoogleSignIn
                  busy={googleBusy}
                  disabled={busy}
                  onClick={() => void requestGoogleSignIn()}
                />
              )}
            </>
          )}
          {name === null && state === 'ready' && <PasteLoginLink />}
        </div>
      </section>
      {name === null && (
        <footer className="welcome-footer">
          <p>Share photos and organize events with friends.</p>
          <a href="/privacy/">Privacy</a>
        </footer>
      )}
    </main>
  );
}
