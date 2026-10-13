import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from '../../api';
import { Dialog } from '../../ui/Dialog';
import { ProfilePhoto } from './ProfilePhoto';
import {
  decodePhoto,
  drawCrop,
  encodeCrop,
  initialCrop,
  moveCrop,
  type Crop,
} from './crop';

export function AvatarForm({
  handle,
  onChange,
  onboarding = false,
}: {
  handle: string;
  onChange: () => void;
  onboarding?: boolean;
}) {
  const [version, setVersion] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState<{
    file: File;
    image: ImageBitmap;
  } | null>(null);
  const [crop, setCrop] = useState(initialCrop);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const canvas = useRef<HTMLCanvasElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const prepared = useRef<{ id: string; blob: Blob } | null>(null);
  const controller = useRef<AbortController | null>(null);
  const image = source?.file === file ? source?.image : null;

  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (!file) return;
    let active = true;
    let bitmap: ImageBitmap | undefined;
    void decodePhoto(file)
      .then((decoded) => {
        bitmap = decoded;
        if (active) setSource({ file, image: decoded });
        else decoded.close();
      })
      .catch((failure: unknown) => {
        if (active)
          setError(
            failure instanceof Error
              ? failure.message
              : 'Could not open photo.',
          );
      });
    return () => {
      active = false;
      bitmap?.close();
    };
  }, [file]);
  useEffect(() => {
    if (!canvas.current || !image) return;
    const preview = canvas.current;
    const frame = requestAnimationFrame(() => {
      try {
        drawCrop(preview, image, crop);
      } catch (failure) {
        setError(
          failure instanceof Error
            ? failure.message
            : 'Could not preview crop.',
        );
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [image, crop]);

  function adjust(next: Crop) {
    setCrop(next);
    prepared.current = null;
    setError('');
    setMessage('');
  }
  function cancel() {
    if (controller.current) return;
    setFile(null);
    setSource(null);
    prepared.current = null;
    drag.current = null;
    setError('');
  }
  async function upload(event: FormEvent) {
    event.preventDefault();
    if (!image || controller.current) return;
    setBusy(true);
    setMessage('');
    setError('');
    const request = new AbortController();
    controller.current = request;
    try {
      const payload = prepared.current ?? {
        id: crypto.randomUUID(),
        blob: await encodeCrop(image, crop),
      };
      if (request.signal.aborted) return;
      prepared.current = payload;
      await api('/api/avatar', {
        method: 'PUT',
        headers: {
          'Idempotency-Key': payload.id,
          'Content-Type': payload.blob.type,
        },
        body: payload.blob,
        signal: request.signal,
      });
      if (request.signal.aborted) return;
      setVersion((value) => value + 1);
      setFile(null);
      setSource(null);
      prepared.current = null;
      if (input.current) input.current.value = '';
      setMessage('Profile photo saved.');
      onChange();
    } catch (failure) {
      if (!request.signal.aborted)
        setError(failure instanceof Error ? failure.message : 'Upload failed.');
    } finally {
      if (!request.signal.aborted) {
        controller.current = null;
        setBusy(false);
      }
    }
  }
  return (
    <section className="avatar-form" aria-label="Profile photo">
      {!onboarding && <h3>Profile photo</h3>}
      {!onboarding && (
        <ProfilePhoto key={version} handle={handle} version={version} />
      )}
      <div className="avatar-choose">
        <button
          type="button"
          className={onboarding ? 'primary-button' : 'text-button'}
          aria-describedby="avatar-file-help"
          onClick={() => input.current?.click()}
        >
          {onboarding ? 'Choose profile photo' : 'Change photo'}
        </button>
        <input
          ref={input}
          id="avatar-file"
          type="file"
          hidden
          aria-label="Choose profile photo"
          accept="image/jpeg,image/png,image/webp"
          onChange={(event) => {
            const selected = event.target.files?.[0];
            event.target.value = '';
            if (!selected) return;
            setFile(selected);
            setCrop(initialCrop);
            prepared.current = null;
            drag.current = null;
            setError('');
            setMessage('');
          }}
        />
        <p id="avatar-file-help" className="avatar-help">
          JPEG, PNG, or WebP. Up to 8 MB and 40 megapixels.
          <br />
          Visible to signed-in members.
        </p>
      </div>
      {message && <p role="status">{message}</p>}
      {file && (
        <Dialog title="Crop profile photo" busy={busy} onClose={cancel}>
          <form onSubmit={(event) => void upload(event)} aria-busy={busy}>
            {file && !image && !error && <p role="status">Opening photo…</p>}
            {image && (
              <div className="avatar-crop">
                <canvas
                  ref={canvas}
                  className="avatar-crop-preview"
                  width={640}
                  height={640}
                  tabIndex={busy ? -1 : 0}
                  role="img"
                  aria-label="Profile photo crop preview"
                  aria-describedby="avatar-crop-help"
                  onPointerDown={(event) => {
                    if (busy || event.button !== 0) return;
                    event.currentTarget.setPointerCapture(event.pointerId);
                    drag.current = {
                      id: event.pointerId,
                      x: event.clientX,
                      y: event.clientY,
                    };
                  }}
                  onPointerMove={(event) => {
                    const previous = drag.current;
                    if (busy || !previous || previous.id !== event.pointerId)
                      return;
                    const bounds = event.currentTarget.getBoundingClientRect();
                    if (!bounds.width || !bounds.height) return;
                    adjust(
                      moveCrop(
                        image.width,
                        image.height,
                        crop,
                        (event.clientX - previous.x) / bounds.width,
                        (event.clientY - previous.y) / bounds.height,
                      ),
                    );
                    drag.current = {
                      id: event.pointerId,
                      x: event.clientX,
                      y: event.clientY,
                    };
                  }}
                  onPointerUp={() => {
                    drag.current = null;
                  }}
                  onPointerCancel={() => {
                    drag.current = null;
                  }}
                  onLostPointerCapture={() => {
                    drag.current = null;
                  }}
                  onKeyDown={(event) => {
                    if (busy) return;
                    const step = event.shiftKey ? 0.1 : 0.025;
                    const delta = {
                      ArrowLeft: [-step, 0],
                      ArrowRight: [step, 0],
                      ArrowUp: [0, -step],
                      ArrowDown: [0, step],
                    }[event.key];
                    if (!delta) return;
                    event.preventDefault();
                    adjust(
                      moveCrop(
                        image.width,
                        image.height,
                        crop,
                        delta[0],
                        delta[1],
                      ),
                    );
                  }}
                />
                <p id="avatar-crop-help" className="status-copy">
                  Drag the photo or use arrow keys to position it. Adjust the
                  zoom to crop.
                </p>
                <label className="field-label" htmlFor="avatar-zoom">
                  Zoom
                </label>
                <input
                  id="avatar-zoom"
                  type="range"
                  min={1}
                  max={4}
                  step={0.01}
                  value={crop.zoom}
                  disabled={busy}
                  aria-valuetext={`${Math.round(crop.zoom * 100)}%`}
                  onChange={(event) =>
                    adjust({ ...crop, zoom: Number(event.target.value) })
                  }
                />
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() => adjust(initialCrop)}
                >
                  Reset crop
                </button>
              </div>
            )}
            {error && (
              <p role="alert" className="error-message">
                {error}
              </p>
            )}
            <div className="avatar-crop-actions">
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={cancel}
              >
                Cancel
              </button>
              <button className="primary-button" disabled={busy || !image}>
                {busy ? 'Saving…' : 'Use photo'}
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </section>
  );
}
