import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, ApiError, jsonRequest } from '../../api';
import {
  PhotoProgress,
  type PhotoProgressState,
} from '../../images/PhotoProgress';
import { InlineField } from '../../ui/InlineField';
import { PostCropEditor } from './PostCropEditor';
import { fullPhoto, type Rectangle } from './crop';

function PhotoIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="2" />
      <path d="m21 16-5-5-11 9" />
    </svg>
  );
}

// A post, edited in place: selecting the photo area chooses and crops the
// photo, and the caption is typed where it will appear. The author header
// isn't a link, so a click can't drop the draft.
export function Compose({
  handle,
  onPublished,
  onCancel,
}: {
  handle: string;
  onPublished: () => void;
  onCancel: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [source, setSource] = useState<{ file: File; crop: Rectangle } | null>(
    null,
  );
  const [editing, setEditing] = useState<{
    file: File;
    crop: Rectangle;
  } | null>(null);
  const [caption, setCaption] = useState('');
  const [id, setId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [progress, setProgress] = useState<PhotoProgressState>({
    phase: 'starting',
  });
  const [submitted, setSubmitted] = useState<{ caption: string } | null>(null);
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  useEffect(() => () => controller.current?.abort(), []);
  async function publish(event: FormEvent) {
    event.preventDefault();
    if (!file || busy || controller.current || editing) return;
    setBusy(true);
    setProgress({ phase: 'starting' });
    setError('');
    const request = new AbortController();
    controller.current = request;
    try {
      if (file.size > 8 * 1024 * 1024)
        throw new Error('Choose a photo smaller than 8 MB.');
      const details = submitted ?? { caption };
      setSubmitted(details);
      const draft = await api<{ state: string }>('/api/posts', {
        ...jsonRequest('POST', { id, caption: details.caption, altText: '' }),
        signal: request.signal,
        timeoutMs: 30_000,
      });
      if (request.signal.aborted) return;
      if (draft.state !== 'published')
        await api(`/api/posts/${id}/photo`, {
          method: 'PUT',
          headers: { 'Content-Type': file.type || 'application/octet-stream' },
          body: file,
          signal: request.signal,
          onUploadProgress: (percent) => {
            if (!request.signal.aborted)
              setProgress({
                phase: percent === 100 ? 'processing' : 'uploading',
                percent,
              });
          },
        });
      if (!request.signal.aborted) onPublished();
    } catch (error) {
      if (!request.signal.aborted)
        setError(
          error instanceof Error
            ? error.message
            : 'Upload failed. You can retry this upload.',
        );
    } finally {
      if (controller.current === request) {
        controller.current = null;
        setBusy(false);
      }
    }
  }
  async function cancel() {
    if (cancelling) return;
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setBusy(true);
    setCancelling(true);
    setProgress({ phase: 'cancelling' });
    let confirmed = false;
    try {
      await api(`/api/posts/${id}`, {
        method: 'DELETE',
        signal: request.signal,
        timeoutMs: 30_000,
      });
      confirmed = true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) confirmed = true;
      /* An interrupted request may have reached the server. */
    }
    if (request.signal.aborted) return;
    controller.current = null;
    if (confirmed) {
      setId(crypto.randomUUID());
      setSubmitted(null);
    }
    setBusy(false);
    setCancelling(false);
    setError(
      confirmed
        ? 'Upload cancelled.'
        : 'Cancellation could not be confirmed. Check your profile before trying again.',
    );
  }
  const locked = busy || submitted !== null;
  return (
    <>
      <form
        className="post post-compose"
        onSubmit={(event) => void publish(event)}
      >
        <header>
          <span className="person-link">
            <img
              src={`/media/avatar/${encodeURIComponent(handle)}`}
              width={36}
              height={36}
              alt=""
            />
            <strong>{handle}</strong>
          </span>
        </header>
        <div className="compose-photo">
          <input
            id="post-file"
            className="visually-hidden"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            aria-label={preview ? 'Change photo' : 'Add photo'}
            aria-describedby="post-file-help"
            disabled={locked}
            onChange={(event) => {
              const selected = event.target.files?.[0];
              event.target.value = '';
              if (selected) setEditing({ file: selected, crop: fullPhoto });
            }}
          />
          <label htmlFor="post-file" className="compose-photo-choose">
            {file && preview ? (
              <img
                className="post-photo"
                src={preview}
                alt="Selected photo preview"
              />
            ) : (
              <span className="compose-photo-empty">
                <PhotoIcon />
                <strong>Add photo</strong>
                <span id="post-file-help">
                  One still JPEG, PNG, or WebP. Up to 32 MB and 40 megapixels.
                </span>
              </span>
            )}
          </label>
          {file && preview && !locked && (
            <span className="photo-edit-actions">
              <button
                type="button"
                className="photo-edit-action"
                onClick={() => setEditing(source)}
              >
                Adjust crop
              </button>
              <label
                htmlFor="post-file"
                className="photo-edit-action"
                aria-hidden="true"
              >
                Change photo
              </label>
            </span>
          )}
        </div>
        <div className="post-body">
          <p className="post-caption">
            <InlineField
              id="caption"
              aria-label="Caption"
              placeholder="Add a caption"
              multiline
              maxLength={2000}
              value={caption}
              disabled={locked}
              onChange={(event) => setCaption(event.target.value)}
            />
          </p>
          {busy && <PhotoProgress progress={progress} />}
          {!busy && submitted && (
            <p className="field-help">
              Retry to check this upload. Cancel it before changing the photo or
              caption.
            </p>
          )}
          {error && (
            <p role="alert" className="error-message">
              {error}
            </p>
          )}
          <div className="editor-actions">
            {locked ? (
              <button
                type="button"
                disabled={cancelling}
                onClick={() => void cancel()}
              >
                Cancel upload
              </button>
            ) : (
              <button type="button" onClick={onCancel}>
                Cancel
              </button>
            )}
            <button className="primary-button" disabled={busy || !file}>
              {busy ? 'Saving…' : submitted ? 'Retry upload' : 'Publish photo'}
            </button>
          </div>
        </div>
      </form>
      {editing && (
        <PostCropEditor
          file={editing.file}
          initial={editing.crop}
          onClose={() => setEditing(null)}
          onApply={(cropped, crop) => {
            setFile(cropped);
            setSource({ file: editing.file, crop });
            setPreview(URL.createObjectURL(cropped));
            setId(crypto.randomUUID());
            setSubmitted(null);
            setError('');
            setEditing(null);
          }}
        />
      )}
    </>
  );
}
