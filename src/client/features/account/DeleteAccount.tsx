import { useState, type FormEvent } from 'react';
import { api, jsonRequest } from '../../api';
export function DeleteAccount() {
  const [confirmation, setConfirmation] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function remove(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/api/me', jsonRequest('DELETE', { confirmation }));
      location.assign('/');
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Deletion could not be confirmed. Reload to check your account.',
      );
      setBusy(false);
    }
  }
  return (
    <section>
      <h3>Delete account</h3>
      <p>
        This permanently removes your account and hides your photos and comments
        immediately. Stored files are deleted in the background. Invitation
        relationships and timestamps are retained for abuse investigations.
        Existing backups expire under the backup retention policy.
      </p>
      <p>
        This cannot be undone. To join again, you would need a new invitation.
      </p>
      <form onSubmit={(e) => void remove(e)}>
        <label className="field-label" htmlFor="delete-confirmation">
          Type DELETE to confirm
        </label>
        <input
          id="delete-confirmation"
          value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)}
          disabled={busy}
          autoComplete="off"
        />
        <button disabled={busy || confirmation !== 'DELETE'}>
          {busy ? 'Deleting…' : 'Delete my account'}
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
