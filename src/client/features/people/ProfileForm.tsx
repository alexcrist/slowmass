import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, jsonRequest } from '../../api';
import { UsernameField } from './UsernameField';
import { SetupSignOut } from './SetupSignOut';
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
  onSignOut,
  signingOut = false,
}: {
  profile: Profile | null;
  onSave: (profile: Profile) => void;
  // Name-only event joining keeps a generated username.
  mode?: 'profile' | 'name';
  onSignOut?: () => void;
  signingOut?: boolean;
}) {
  const [handle, setHandle] = useState(profile?.handle ?? '');
  const [displayName, setDisplayName] = useState(profile?.displayName ?? '');
  const [bio, setBio] = useState(profile?.bio ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const disabled = busy || signingOut;
  async function save(event: FormEvent) {
    event.preventDefault();
    if (controller.current || signingOut) return;
    const request = new AbortController();
    controller.current = request;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      // Name-only saves keep the username, or let the server generate one.
      const result = await api<{ profile: Profile }>('/api/people/self', {
        ...jsonRequest(
          'PUT',
          mode === 'name' ? { displayName, bio } : { handle, displayName, bio },
        ),
        signal: request.signal,
        timeoutMs: 30_000,
      });
      if (request.signal.aborted) return;
      onSave(result.profile);
      setMessage('Profile saved.');
    } catch (error) {
      if (!request.signal.aborted)
        setError(
          error instanceof Error ? error.message : 'Could not save profile.',
        );
    } finally {
      if (!request.signal.aborted) {
        controller.current = null;
        setBusy(false);
      }
    }
  }
  const joining = !profile && mode === 'name';
  const nameInput = (
    <input
      id="display-name"
      value={displayName}
      onChange={(event) => setDisplayName(event.target.value)}
      required
      maxLength={60}
      disabled={disabled}
      autoComplete="name"
    />
  );
  return (
    <form onSubmit={(event) => void save(event)}>
      {!profile && mode === 'profile' && (
        <p className="status-copy">
          Your bio is visible only to accepted followers.
        </p>
      )}
      {mode !== 'name' && (
        <UsernameField
          value={handle}
          onChange={setHandle}
          disabled={disabled}
          editing={Boolean(profile)}
        />
      )}
      <label className="field-label" htmlFor="display-name">
        {mode === 'name' ? 'Your name' : 'Profile name'}
      </label>
      {joining ? (
        // Naming yourself while joining mirrors the email step before it.
        <div className="joined-field">
          {nameInput}
          <button
            type="submit"
            className="joined-submit"
            disabled={disabled}
            aria-label={busy ? 'Saving…' : 'Continue'}
            title="Continue"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </button>
        </div>
      ) : (
        nameInput
      )}
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
            disabled={disabled}
          />
        </>
      )}
      {!joining && (
        <button className="primary-button" disabled={disabled}>
          {busy
            ? 'Saving…'
            : !profile
              ? 'Continue'
              : mode === 'name'
                ? 'Save name'
                : 'Save profile'}
        </button>
      )}
      {onSignOut && (
        <SetupSignOut
          onSignOut={() => {
            controller.current?.abort();
            controller.current = null;
            setBusy(false);
            onSignOut();
          }}
          signingOut={signingOut}
        />
      )}
      {message && <p role="status">{message}</p>}
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
    </form>
  );
}
