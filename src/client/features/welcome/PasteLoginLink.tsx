import { useState, type FormEvent } from 'react';
import { loginLinkTarget } from './login-link';

export function PasteLoginLink() {
  const [link, setLink] = useState('');
  const [error, setError] = useState('');
  function submit(event: FormEvent) {
    event.preventDefault();
    const target = loginLinkTarget(link, location.origin);
    if (!target) {
      setError('Paste the complete Slowmass sign-in link from your email.');
      return;
    }
    setLink('');
    setError('');
    window.location.assign(target);
  }
  return (
    <details className="login-link-help">
      <summary>Sign in inside the installed app</summary>
      <p>
        If your email link opens a separate browser, request a new link above.
        In your email, press and hold the sign-in link and copy it{' '}
        <strong>without opening it</strong>. Return to the Slowmass app and
        paste it here. Links work once and expire after 10 minutes.
      </p>
      <form onSubmit={submit}>
        <label className="field-label" htmlFor="login-link">
          Unused sign-in link
        </label>
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
        <p id="login-link-help" className="field-help">
          This link signs you in. Do not share it with anyone.
        </p>
        <button type="submit" className="primary-button">
          Sign in here
        </button>
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
      </form>
    </details>
  );
}
