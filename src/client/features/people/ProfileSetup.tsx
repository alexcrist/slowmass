import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, jsonRequest } from '../../api';
import {
  PhotoProgress,
  type PhotoProgressState,
} from '../../images/PhotoProgress';
import { AvatarForm, uploadAvatar, type PreparedAvatar } from '../avatars';
import type { Profile } from './ProfileForm';
import { UsernameField } from './UsernameField';
import { SetupSignOut } from './SetupSignOut';

export function ProfileSetup({
  profile,
  eventRoute,
  startImmediately,
  onFinish,
  onSignOut,
  signingOut,
}: {
  profile: Profile;
  eventRoute: string | undefined;
  startImmediately: boolean;
  onFinish: (profile: Profile) => void;
  onSignOut: () => void;
  signingOut: boolean;
}) {
  const [started, setStarted] = useState(startImmediately);
  const [handle, setHandle] = useState(profile.handle);
  const [photo, setPhoto] = useState<PreparedAvatar | null>(null);
  const [busy, setBusy] = useState(false);
  const disabled = busy || signingOut;
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<PhotoProgressState>({
    phase: 'saving',
  });
  const controller = useRef<AbortController | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (started) heading.current?.focus();
  }, [started]);

  async function finish(event: FormEvent) {
    event.preventDefault();
    if (controller.current || signingOut) return;
    if (!photo) {
      setError('Choose a profile photo to finish setting up your account.');
      return;
    }
    const request = new AbortController();
    controller.current = request;
    setBusy(true);
    setError('');
    setProgress({ phase: 'saving' });
    try {
      // Reserve/validate the username before publishing the photo, which is
      // what grants full membership. A failed photo retains the saved name.
      const result = await api<{ profile: Profile }>('/api/people/self', {
        ...jsonRequest('PUT', {
          handle,
          displayName: profile.displayName,
          bio: profile.bio,
        }),
        signal: request.signal,
        timeoutMs: 30_000,
      });
      if (request.signal.aborted) return;
      setProgress({ phase: 'uploading' });
      await uploadAvatar(photo, request.signal, setProgress);
      if (!request.signal.aborted)
        onFinish({ ...result.profile, hasAvatar: 1 });
    } catch (failure) {
      if (!request.signal.aborted)
        setError(
          failure instanceof Error
            ? failure.message
            : 'Could not finish setup. Try again.',
        );
    } finally {
      if (!request.signal.aborted) {
        controller.current = null;
        setBusy(false);
      }
    }
  }

  return (
    <>
      <h1 id="screen-title" ref={heading} tabIndex={-1}>
        Set up your account
      </h1>
      {!started ? (
        <>
          <p className="onboarding-intro">
            To use the rest of slowmass, choose a username and add a profile
            photo. Then you can share photos and follow friends. Follow requests
            need your approval.
          </p>
          <div className="setup-actions">
            <button
              type="button"
              className="primary-button"
              onClick={() => setStarted(true)}
              disabled={signingOut}
            >
              Continue
            </button>
            <a
              className="button-link"
              href={eventRoute ? `#${eventRoute}` : '#events'}
            >
              {eventRoute ? 'Back to event' : 'Back to events'}
            </a>
          </div>
        </>
      ) : (
        <>
          <AvatarForm draft={photo} onSelect={setPhoto} disabled={disabled} />
          <form className="setup-form" onSubmit={(event) => void finish(event)}>
            <UsernameField
              value={handle}
              onChange={setHandle}
              disabled={disabled}
            />
            {busy && <PhotoProgress progress={progress} />}
            {error && (
              <p role="alert" className="error-message">
                {error}
              </p>
            )}
            <button className="primary-button" disabled={disabled || !photo}>
              {busy ? 'Finishing…' : 'Finish'}
            </button>
          </form>
        </>
      )}
      <SetupSignOut
        onSignOut={() => {
          controller.current?.abort();
          controller.current = null;
          setBusy(false);
          onSignOut();
        }}
        signingOut={signingOut}
      />
    </>
  );
}
