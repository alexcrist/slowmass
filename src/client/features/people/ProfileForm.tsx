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
  nameOnly = false,
}: {
  profile: Profile | null;
  onSave: (profile: Profile) => void;
  // Event-only members just name themselves; their generated username and
  // empty bio are saved unchanged.
  nameOnly?: boolean;
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
          nameOnly ? { displayName, bio } : { handle, displayName, bio },
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
      {!profile && !nameOnly && (
        <p className="status-copy">
          Your username, name, and profile photo are visible to other members.
          Your bio is visible only to accepted followers.
        </p>
      )}
      {!nameOnly && (
        <>
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
            disabled={busy}
            autoCapitalize="none"
            autoComplete="username"
            aria-describedby="handle-help"
          />
          <p id="handle-help" className="field-help">
            3–30 letters, numbers, or underscores.
            {profile &&
              ' Changing it releases your old username and changes your profile link.'}
          </p>
        </>
      )}
      <label className="field-label" htmlFor="display-name">
        {nameOnly ? 'Your name' : 'Profile name'}
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
      {nameOnly ? (
        <p className="field-help">Other members see this name.</p>
      ) : (
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
            : nameOnly
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
