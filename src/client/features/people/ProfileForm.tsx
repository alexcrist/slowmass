import { useState, type FormEvent } from 'react';
import { api, jsonRequest } from '../../api';
export type Profile = {
  handle: string;
  displayName: string;
  bio: string;
  hasAvatar: number;
};
export function ProfileForm({
  profile,
  onSave,
}: {
  profile: Profile | null;
  onSave: (profile: Profile) => void;
}) {
  const [handle, setHandle] = useState(profile?.handle ?? '');
  const [displayName, setDisplayName] = useState(profile?.displayName ?? '');
  const [bio, setBio] = useState(profile?.bio ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await api<{ profile: Profile }>(
        '/api/people/self',
        jsonRequest('PUT', { handle, displayName, bio }),
      );
      onSave(result.profile);
      setMessage('Profile saved.');
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'Could not save profile.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={(event) => void save(event)}>
      {!profile && (
        <p className="status-copy">
          Your username, name, and profile photo are visible to other members.
          Your bio is visible only to accepted followers.
        </p>
      )}
      <label className="field-label" htmlFor="handle">
        Username
      </label>
      <input
        id="handle"
        value={handle}
        onChange={(event) => setHandle(event.target.value.toLowerCase())}
        pattern="[a-z0-9_]{3,30}"
        minLength={3}
        maxLength={30}
        required
        disabled={busy || Boolean(profile)}
        autoCapitalize="none"
        autoComplete="username"
        aria-describedby="handle-help"
      />
      <p id="handle-help" className="field-help">
        3–30 letters, numbers, or underscores. Usernames cannot be changed yet.
      </p>
      <label className="field-label" htmlFor="display-name">
        Profile name
      </label>
      <input
        id="display-name"
        value={displayName}
        onChange={(event) => setDisplayName(event.target.value)}
        required
        maxLength={60}
        disabled={busy}
        autoComplete="name"
      />
      <label className="field-label" htmlFor="bio">
        Bio
      </label>
      <textarea
        id="bio"
        value={bio}
        onChange={(event) => setBio(event.target.value)}
        maxLength={500}
        rows={4}
        disabled={busy}
      />
      <button className="primary-button" disabled={busy}>
        {busy ? 'Saving…' : profile ? 'Save profile' : 'Create profile'}
      </button>
      {message && <p role="status">{message}</p>}
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
    </form>
  );
}
