import { useState, type FormEvent } from 'react';
import { api, jsonRequest } from '../../api';
import { UsernameField } from './UsernameField';
export type Profile = {
  handle: string;
  displayName: string;
  bio: string;
  hasAvatar: number;
};
export function ProfileForm({
  profile,
  onSave,
  mode = 'profile',
}: {
  profile: Profile | null;
  onSave: (profile: Profile) => void;
  // Name-only event joining keeps a generated username.
  mode?: 'profile' | 'name';
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
      // Name-only saves keep the username, or let the server generate one.
      const result = await api<{ profile: Profile }>(
        '/api/people/self',
        jsonRequest(
          'PUT',
          mode === 'name' ? { displayName, bio } : { handle, displayName, bio },
        ),
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
      {!profile && mode === 'profile' && (
        <p className="status-copy">
          Your username, name, and profile photo are visible to other members.
          Your bio is visible only to accepted followers.
        </p>
      )}
      {mode !== 'name' && (
        <UsernameField
          value={handle}
          onChange={setHandle}
          disabled={busy}
          editing={Boolean(profile)}
        />
      )}
      <label className="field-label" htmlFor="display-name">
        {mode === 'name' ? 'Your name' : 'Profile name'}
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
      {mode === 'profile' && (
        <>
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
        </>
      )}
      <button className="primary-button" disabled={busy}>
        {busy
          ? 'Saving…'
          : !profile
            ? 'Continue'
            : mode === 'name'
              ? 'Save name'
              : 'Save profile'}
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
