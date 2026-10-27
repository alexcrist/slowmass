import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, jsonRequest } from '../../api';
import {
  PhotoProgress,
  type PhotoProgressState,
} from '../../images/PhotoProgress';
import { InlineField, oneLine } from '../../ui/InlineField';
import {
  AvatarCropDialog,
  uploadAvatar,
  type PreparedAvatar,
} from '../avatars';
import type { Profile } from './ProfileForm';

const handlePattern = /^[a-z0-9_]{3,30}$/;

// The profile header, edited in place: selecting the photo, username, name, or
// bio edits it. A new photo is cropped now and uploaded on Save, after the
// details, so Cancel leaves the current profile untouched.
export function ProfileEditor({
  profile,
  onSaved,
  onPhotoSaved,
  onCancel,
}: {
  profile: Profile;
  onSaved: (profile: Profile) => void;
  onPhotoSaved: () => void;
  onCancel: () => void;
}) {
  const [handle, setHandle] = useState(profile.handle);
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [bio, setBio] = useState(profile.bio);
  const [file, setFile] = useState<File | null>(null);
  const [photo, setPhoto] = useState<PreparedAvatar | null>(null);
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<PhotoProgressState>({
    phase: 'saving',
  });
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  async function save(submit: FormEvent) {
    submit.preventDefault();
    if (busy || file || controller.current) return;
    setError('');
    if (!handlePattern.test(handle)) {
      setError('Usernames use 3–30 letters, numbers, or underscores.');
      return;
    }
    if (!displayName.trim()) {
      setError('Enter a profile name.');
      return;
    }
    const request = new AbortController();
    controller.current = request;
    setBusy(true);
    setProgress({ phase: 'saving' });
    try {
      // Saving the same details again is harmless, so a retry after a failed
      // photo resends both, with the photo's original idempotency key.
      const result = await api<{ profile: Profile }>('/api/people/self', {
        ...jsonRequest('PUT', { handle, displayName, bio }),
        signal: request.signal,
        timeoutMs: 30_000,
      });
      if (request.signal.aborted) return;
      if (photo) {
        setProgress({ phase: 'uploading' });
        await uploadAvatar(photo, request.signal, setProgress);
        if (request.signal.aborted) return;
        onPhotoSaved();
      }
      if (!request.signal.aborted) onSaved(result.profile);
    } catch (failure) {
      if (!request.signal.aborted)
        setError(
          failure instanceof Error
            ? failure.message
            : 'Could not save profile.',
        );
    } finally {
      if (controller.current === request) {
        controller.current = null;
        if (!request.signal.aborted) setBusy(false);
      }
    }
  }
  return (
    <>
      <form className="profile-editor" onSubmit={(submit) => void save(submit)}>
        <header className="profile-header">
          <div className="profile-header-row">
            <div className="profile-identity">
              <span className="profile-photo-editor editable">
                <input
                  id="avatar-file"
                  className="visually-hidden"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  aria-label="Change profile photo"
                  disabled={busy}
                  onChange={(change) => {
                    const selected = change.target.files?.[0];
                    change.target.value = '';
                    if (selected) setFile(selected);
                  }}
                />
                <label htmlFor="avatar-file">
                  <img
                    className="avatar"
                    src={
                      preview ||
                      `/media/avatar/${encodeURIComponent(profile.handle)}`
                    }
                    alt={
                      preview
                        ? 'Selected profile photo'
                        : 'Current profile photo'
                    }
                    width={96}
                    height={96}
                  />
                </label>
              </span>
              <div className="profile-editor-names">
                <h2>
                  <InlineField
                    id="handle"
                    aria-label="Username"
                    aria-describedby="handle-help"
                    placeholder="username"
                    required
                    minLength={3}
                    maxLength={30}
                    autoCapitalize="none"
                    autoComplete="username"
                    spellCheck={false}
                    value={handle}
                    disabled={busy}
                    onChange={(change) =>
                      setHandle(
                        oneLine(change.target.value)
                          .toLowerCase()
                          .replace(/\s/g, ''),
                      )
                    }
                  />
                </h2>
                <p>
                  <InlineField
                    id="display-name"
                    aria-label="Profile name"
                    placeholder="Profile name"
                    required
                    maxLength={60}
                    autoComplete="name"
                    value={displayName}
                    disabled={busy}
                    onChange={(change) =>
                      setDisplayName(oneLine(change.target.value))
                    }
                  />
                </p>
              </div>
            </div>
          </div>
          <p className="bio">
            <InlineField
              id="bio"
              aria-label="Bio"
              aria-describedby="bio-help"
              placeholder="Add a bio"
              multiline
              maxLength={500}
              value={bio}
              disabled={busy}
              onChange={(change) => setBio(change.target.value)}
            />
          </p>
        </header>
        <div className="profile-editor-footer">
          <p id="handle-help" className="field-help">
            Usernames use 3–30 letters, numbers, or underscores.
            {handle !== profile.handle &&
              ' Changing yours releases the old one and changes your profile link.'}
          </p>
          <p id="bio-help" className="field-help">
            Only accepted followers see your bio.
          </p>
          {busy && <PhotoProgress progress={progress} />}
          {error && (
            <p role="alert" className="error-message">
              {error}
            </p>
          )}
          <div className="editor-actions">
            <button type="button" disabled={busy} onClick={onCancel}>
              Cancel
            </button>
            <button className="primary-button" disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </form>
      {file && (
        <AvatarCropDialog
          file={file}
          onClose={() => setFile(null)}
          onSelect={(selected) => {
            setFile(null);
            setPhoto(selected);
            setPreview(URL.createObjectURL(selected.blob));
            setError('');
          }}
        />
      )}
    </>
  );
}
