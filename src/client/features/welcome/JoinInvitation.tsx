import { useEffect, useState } from 'react';

type Preview =
  | {
      status: 'ready';
      email: string;
      expiresAt: number;
      inviter: { name: string; handle: string };
      signedInAs: string | null;
    }
  | { status: 'invalid' | 'expired' | 'cancelled' | 'used' };

export function JoinInvitation() {
  // The fragment stays out of HTTP URLs, referrers, and server access logs.
  const [token] = useState(() => location.hash.slice(1));
  const [preview, setPreview] = useState<Preview | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      if (!/^[a-zA-Z0-9]{48}$/.test(token)) {
        setPreview({ status: 'invalid' });
        return;
      }
      try {
        const response = await fetch('/api/auth/invitation/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
          signal: controller.signal,
          cache: 'no-store',
          referrerPolicy: 'no-referrer',
        });
        if (!response.ok) throw new Error();
        const data = (await response.json()) as Preview;
        if (!controller.signal.aborted) setPreview(data);
      } catch {
        if (!controller.signal.aborted)
          setError(
            'We couldn’t check this invitation. Check your connection and try again in a moment.',
          );
      }
    }
    void load();
    return () => controller.abort();
  }, [token, attempt]);

  function retry() {
    setPreview(null);
    setError('');
    setAttempt((value) => value + 1);
  }

  async function accept() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/auth/invitation/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
      });
      if (response.ok) {
        location.replace('/');
        return;
      }
      const result = (await response.json()) as { code?: string };
      if (
        result.code === 'INVITATION_UNAVAILABLE' ||
        result.code === 'SIGN_OUT_REQUIRED'
      )
        retry();
      else
        setError(
          'We couldn’t accept your invitation. Wait a minute and try again, or use email sign-in.',
        );
    } catch {
      setError(
        'We couldn’t confirm joining. Try again, or open slowmass to check whether you’re signed in.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function switchAccount() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/auth/sign-out', { method: 'POST' });
      if (!response.ok) throw new Error();
      retry();
    } catch {
      setError('Could not sign out. Please try again.');
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
      <section className="account-section" aria-label="Invitation">
        <div className="sign-in-area">
          {!preview ? (
            <>
              {!error && <p role="status">Checking your invitation…</p>}
              {error && <button onClick={retry}>Try again</button>}
            </>
          ) : preview.status === 'ready' ? (
            <>
              <h1>Join slowmass</h1>
              <p>
                {preview.inviter.name} (@{preview.inviter.handle}) invited you.
              </p>
              <p>
                Join as <strong>{preview.email}</strong>.
              </p>
              <p className="status-copy">
                You’ll follow each other automatically after you set up your
                profile.
              </p>
              {preview.signedInAs ? (
                <>
                  <p>
                    You’re currently signed in as {preview.signedInAs}. Sign out
                    first to accept this invitation.
                  </p>
                  <button
                    className="primary-button"
                    disabled={busy}
                    onClick={() => void switchAccount()}
                  >
                    {busy ? 'Signing out…' : 'Sign out to continue'}
                  </button>
                </>
              ) : (
                <button
                  className="primary-button"
                  disabled={busy}
                  onClick={() => void accept()}
                >
                  {busy ? 'Joining…' : 'Accept invitation'}
                </button>
              )}
              <p className="field-help">
                Expires {new Date(preview.expiresAt).toLocaleDateString()}.
              </p>
            </>
          ) : (
            <>
              <h1>
                {preview.status === 'used'
                  ? 'Already joined'
                  : 'Invitation unavailable'}
              </h1>
              <p>
                {preview.status === 'used'
                  ? 'This invitation can’t be used again. Open slowmass to continue, or request a new sign-in link for your email.'
                  : preview.status === 'expired'
                    ? 'This invitation has expired. Ask your friend to send a new invitation.'
                    : preview.status === 'cancelled'
                      ? 'This invitation is no longer active. Ask a slowmass member for a new invitation.'
                      : 'This invitation link is incomplete or invalid. Open the full link from your email, or ask your friend for a new invitation.'}
              </p>
            </>
          )}
          {error && (
            <p className="error-message" role="alert">
              {error}
            </p>
          )}
          <p>
            <a href="/">Open slowmass</a>
          </p>
        </div>
      </section>
    </main>
  );
}
