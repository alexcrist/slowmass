import { useRef, useState, type FormEvent } from 'react';
import { api } from '../../api';
export function AvatarForm({
  handle,
  hasAvatar,
  onChange,
}: {
  handle: string;
  hasAvatar: boolean;
  onChange: (present: boolean) => void;
}) {
  const [present, setPresent] = useState(hasAvatar);
  const [version, setVersion] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [uploadId, setUploadId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  async function upload(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    setBusy(true);
    setMessage('');
    setError('');
    try {
      if (file.size > 8 * 1024 * 1024)
        throw new Error('Choose a photo smaller than 8 MB.');
      await api('/api/avatar', {
        method: 'PUT',
        headers: {
          'Idempotency-Key': uploadId,
          'Content-Type': file.type || 'application/octet-stream',
        },
        body: file,
      });
      setPresent(true);
      onChange(true);
      setVersion((value) => value + 1);
      setFile(null);
      if (input.current) input.current.value = '';
      setMessage('Profile photo saved.');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Upload failed.');
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await api('/api/avatar', { method: 'DELETE' });
      setPresent(false);
      onChange(false);
      setMessage('Profile photo removed.');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Removal failed.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="person" aria-label="Profile photo">
      <h3>Profile photo</h3>
      {present && (
        <img
          className="avatar"
          src={`/media/avatar/${handle}?v=${version}`}
          alt="Your profile photo"
          width={120}
          height={120}
        />
      )}
      <form onSubmit={(event) => void upload(event)}>
        <label className="field-label" htmlFor="avatar-file">
          Choose a photo
        </label>
        <input
          ref={input}
          id="avatar-file"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={busy}
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            setUploadId(crypto.randomUUID());
            setError('');
            setMessage('');
          }}
        />
        <p className="field-help">
          Still JPEG, PNG, or WebP. Up to 8 MB and 40 megapixels. Visible to
          signed-in members.
        </p>
        <div className="actions">
          <button disabled={busy || !file}>
            {busy ? 'Saving…' : 'Upload photo'}
          </button>
          {present && (
            <button type="button" disabled={busy} onClick={() => void remove()}>
              Remove photo
            </button>
          )}
        </div>
      </form>
      {message && <p role="status">{message}</p>}
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
    </section>
  );
}
