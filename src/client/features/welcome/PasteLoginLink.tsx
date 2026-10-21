import { useState, type FormEvent } from 'react';
import { loginLinkTarget } from './login-link';
import { LoginSubmit } from './LoginSubmit';

export function PasteLoginLink() {
  const [link, setLink] = useState('');
  const [error, setError] = useState('');
  function submit(event: FormEvent) {
    event.preventDefault();
    const target = loginLinkTarget(link, location.origin);
    if (!target) {
      setError('Paste the complete slowmass sign-in link from your email.');
      return;
    }
    setLink('');
    setError('');
    window.location.assign(target);
  }
  const installed =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (!installed) return null;
  return (
    <details className="login-link-help">
      <summary>Trouble signing in?</summary>
      <p>
        If the link signs you into a different browser, use an unused link here.
        In your email, press and hold the sign-in link and copy it{' '}
        <strong>without opening it</strong>. Paste it below to sign in to this
        app.
      </p>
      <form onSubmit={submit}>
        <label className="field-label" htmlFor="login-link">
          Unused sign-in link
        </label>
        <div className="joined-field">
          <input
            id="login-link"
            type="password"
            value={link}
            onChange={(event) => setLink(event.target.value)}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={4096}
            required
            aria-describedby="login-link-help"
          />
          <LoginSubmit label="Sign in here" />
        </div>
        <p id="login-link-help" className="field-help joined-field-help">
          This link signs you in. Do not share it with anyone.
        </p>
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
      </form>
    </details>
  );
}
