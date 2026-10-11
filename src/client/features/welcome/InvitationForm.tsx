import { useState, type FormEvent } from 'react';

export function InvitationForm() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [invited, setInvited] = useState('');
  const [error, setError] = useState('');
  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setInvited('');
    setError('');
    try {
      const response = await fetch('/api/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!response.ok) {
        setError(
          response.status === 409
            ? 'This invitation may already exist, or you’ve reached the limit of five invitations per day.'
            : 'We couldn’t create the invitation. Please try again.',
        );
        return;
      }
      setInvited(email.trim().toLowerCase());
      setEmail('');
    } catch {
      setError('We couldn’t connect. Please try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="invitation-form" onSubmit={(event) => void invite(event)}>
      <label className="field-label" htmlFor="invite-email">
        Invite a friend by email
      </label>
      <input
        id="invite-email"
        type="email"
        autoComplete="off"
        maxLength={254}
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        disabled={busy}
      />
      <button className="primary-button" disabled={busy} type="submit">
        {busy ? 'Creating invitation…' : 'Create invitation'}
      </button>
      {invited && (
        <p className="status-copy" role="status">
          Invitation ready for {invited}. Share {location.origin} with your
          friend. They’ll need to sign in with that email within seven days. We
          haven’t emailed them.
        </p>
      )}
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
