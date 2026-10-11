import { useState, type FormEvent } from 'react';
import { api, jsonRequest } from '../../api';
import { useApiResource } from '../../api/useApiResource';
type Item = {
  id: string;
  email: string;
  createdAt: number;
  expiresAt: number;
  accepted: boolean;
  expired: boolean;
  revokedAt: number | null;
};
export function InvitationForm() {
  const [email, setEmail] = useState(''),
    [busy, setBusy] = useState(false),
    [invited, setInvited] = useState(''),
    [error, setError] = useState(''),
    [copyStatus, setCopyStatus] = useState(''),
    [history, setHistory] = useState(['']);
  const after = history[history.length - 1];
  const {
    data: page,
    error: loadError,
    loading,
    reload,
  } = useApiResource<{
    items: Item[];
    next: string | null;
  }>(`/api/invitations?after=${encodeURIComponent(after)}`);
  async function invite(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setInvited('');
    setCopyStatus('');
    try {
      await api('/api/invitations', jsonRequest('POST', { email }));
      setInvited(email.trim().toLowerCase());
      setEmail('');
      setHistory(['']);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create invitation.');
    } finally {
      setBusy(false);
    }
  }
  async function revoke(id: string) {
    setBusy(true);
    setError('');
    try {
      await api(`/api/invitations/${id}`, { method: 'DELETE' });
      if (page?.items.find((item) => item.id === id)?.email === invited)
        setInvited('');
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not cancel invitation.');
    } finally {
      setBusy(false);
    }
  }
  const message = `I invited you to Slowmass. Go to ${location.origin} and sign in with ${invited} within 7 days. We'll automatically follow each other when you finish creating your profile.`;
  async function copy() {
    try {
      await navigator.clipboard.writeText(message);
      setCopyStatus('Message copied.');
    } catch {
      setCopyStatus('Select and copy the message above.');
    }
  }
  return (
    <>
      <p>
        Invite a friend using the email they’ll sign in with. Then send them the
        message below yourself. You’ll follow each other automatically once they
        join.
      </p>
      <form onSubmit={(e) => void invite(e)}>
        <label className="field-label" htmlFor="invite-email">
          Friend’s email
        </label>
        <input
          id="invite-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          maxLength={254}
          disabled={busy}
        />
        <p className="field-help">
          Up to 5 invitations per day. Each lasts 7 days.
        </p>
        <button className="primary-button" disabled={busy}>
          {busy ? 'Saving…' : 'Create invitation'}
        </button>
      </form>
      {invited && (
        <div className="invitation-result">
          <h2>Invitation ready</h2>
          <p>Send this to your friend. No invitation email has been sent.</p>
          <p>{message}</p>
          <button onClick={() => void copy()}>Copy invitation message</button>
          <p role="status">{copyStatus}</p>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      <h2>Your invitations</h2>
      {loading && <p role="status">Loading invitations…</p>}
      {loadError && (
        <div>
          <p role="alert">{loadError}</p>
          <button onClick={reload}>Reload invitations</button>
        </div>
      )}
      {page?.items.length === 0 && <p>No invitations yet.</p>}
      <ul className="people-list">
        {page?.items.map((item) => (
          <li key={item.id}>
            <strong>{item.email}</strong>
            <p>
              {item.accepted
                ? 'Joined'
                : item.revokedAt
                  ? 'Cancelled'
                  : item.expired
                    ? 'Expired'
                    : 'Waiting to join'}
            </p>
            <small>Created {new Date(item.createdAt).toLocaleString()}</small>
            {!item.accepted && !item.revokedAt && !item.expired && (
              <button
                className="text-button"
                disabled={busy}
                onClick={() => void revoke(item.id)}
              >
                Cancel invitation
              </button>
            )}
          </li>
        ))}
      </ul>
      <nav className="actions" aria-label="Invitation pages">
        {history.length > 1 && (
          <button
            disabled={busy || loading}
            onClick={() => {
              setHistory(history.slice(0, -1));
            }}
          >
            Previous
          </button>
        )}
        {page?.next && (
          <button
            disabled={busy || loading}
            onClick={() => {
              setHistory([...history, page.next!]);
            }}
          >
            Next
          </button>
        )}
      </nav>
    </>
  );
}
