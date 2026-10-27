import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, jsonRequest } from '../../api';
import { SetupSignOut } from './SetupSignOut';
export type Profile = {
  handle: string;
  displayName: string;
  bio: string;
  hasAvatar: number;
};
// Names a new member, or renames one who hasn't finished setup. The username
// stays generated until setup; the full profile is edited in ProfileEditor.
export function ProfileForm({
  profile,
  onSave,
  onSignOut,
  signingOut = false,
}: {
  profile: Profile | null;
  onSave: (profile: Profile) => void;
  onSignOut?: () => void;
  signingOut?: boolean;
}) {
  const [displayName, setDisplayName] = useState(profile?.displayName ?? '');
  const bio = profile?.bio ?? '';
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
        ...jsonRequest('PUT', { displayName, bio }),
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
  const joining = !profile;
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
      <label className="field-label" htmlFor="display-name">
        Your name
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
      {!joining && (
        <button className="primary-button" disabled={disabled}>
          {busy ? 'Saving…' : 'Save name'}
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
