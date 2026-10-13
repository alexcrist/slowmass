import { InviteLink } from './InviteLink';
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
  sentAt: number | null;
  attemptedAt: number | null;
};
export function InvitationForm() {
  const [email, setEmail] = useState(''),
    [busy, setBusy] = useState(false),
    [invited, setInvited] = useState(''),
    [error, setError] = useState(''),
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
    try {
      await api('/api/invitations', jsonRequest('POST', { email }));
      setInvited(email.trim().toLowerCase());
      setEmail('');
      setHistory(['']);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create invitation.');
      reload();
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
  async function send(id: string) {
    setBusy(true);
    setError('');
    try {
      await api(`/api/invitations/${id}/send`, { method: 'POST' });
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send invitation.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <InviteLink />
      <h2>Invite by email</h2>
      <p>
        Invite a friend using the email they’ll sign in with. We’ll email them a
        personal link to join directly. You’ll follow each other automatically
        once they join.
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
        <p className="field-help">Invitations last 7 days.</p>
        <button className="primary-button" disabled={busy}>
          {busy ? 'Sending…' : 'Send invitation'}
        </button>
      </form>
      {invited && (
        <div className="invitation-result" role="status">
          <p>Invitation emailed to {invited}.</p>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      <h2>Your invitations</h2>
      {loading && <p role="status">Loading invitations…</p>}
      {loadError && (
        <div>
          <p role="alert">{loadError}</p>
          <button onClick={reload}>Retry</button>
        </div>
      )}
      {page?.items.length === 0 && <p>No invitations yet.</p>}
      <ul className="people-list invitation-list">
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
                    : item.sentAt
                      ? 'Email sent · Waiting to join'
                      : item.attemptedAt
                        ? 'Email delivery unconfirmed'
                        : 'Email not sent'}
            </p>
            <div className="invitation-meta">
              <time
                dateTime={new Date(item.sentAt ?? item.createdAt).toISOString()}
              >
                {item.sentAt ? 'Sent' : 'Created'}{' '}
                {new Date(item.sentAt ?? item.createdAt).toLocaleString()}
              </time>
              {!item.accepted && !item.revokedAt && !item.expired && (
                <div className="invitation-actions">
                  {!item.sentAt && (
                    <button
                      type="button"
                      className="text-button"
                      disabled={busy}
                      onClick={() => void send(item.id)}
                    >
                      {item.attemptedAt ? 'Retry email' : 'Send email'}
                    </button>
                  )}
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => void revoke(item.id)}
                  >
                    Cancel invitation
                  </button>
                </div>
              )}
            </div>
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
