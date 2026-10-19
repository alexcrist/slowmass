import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent,
} from 'react';
import { api } from '../../api';
import {
  PhotoProgress,
  type PhotoProgressState,
} from '../../images/PhotoProgress';
import { Dialog } from '../../ui/Dialog';
import { ProfilePhoto } from './ProfilePhoto';
import {
  decodePhoto,
  drawCrop,
  encodeCrop,
  initialCrop,
  moveCrop,
  pinchCrop,
  type Crop,
  type CropPoint,
} from './crop';

function pointerPosition(
  event: PointerEvent<HTMLCanvasElement>,
): CropPoint | null {
  const bounds = event.currentTarget.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return null;
  return {
    x: (event.clientX - bounds.left) / bounds.width,
    y: (event.clientY - bounds.top) / bounds.height,
  };
}

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
  const [progress, setProgress] = useState<PhotoProgressState>({
    phase: 'preparing',
  });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const canvas = useRef<HTMLCanvasElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const pointers = useRef(new Map<number, CropPoint>());
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

  function adjust(next: Crop | ((current: Crop) => Crop)) {
    setCrop(next);
    prepared.current = null;
    setError('');
    setMessage('');
  }
  function startGesture(event: PointerEvent<HTMLCanvasElement>) {
    if (
      busy ||
      controller.current ||
      event.button !== 0 ||
      pointers.current.size >= 2
    )
      return;
    const point = pointerPosition(event);
    if (!point) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, point);
  }
  function moveGesture(event: PointerEvent<HTMLCanvasElement>) {
    if (
      busy ||
      controller.current ||
      !image ||
      !pointers.current.has(event.pointerId)
    )
      return;
    const point = pointerPosition(event);
    if (!point) return;
    const from = [...pointers.current.values()];
    pointers.current.set(event.pointerId, point);
    const to = [...pointers.current.values()];
    const [start, secondStart] = from;
    const [end, secondEnd] = to;
    if (!start || !end) return;
    adjust((current) =>
      secondStart && secondEnd
        ? pinchCrop(
            image.width,
            image.height,
            current,
            [start, secondStart],
            [end, secondEnd],
          )
        : moveCrop(
            image.width,
            image.height,
            current,
            end.x - start.x,
            end.y - start.y,
          ),
    );
  }
  function endGesture(event: PointerEvent<HTMLCanvasElement>) {
    pointers.current.delete(event.pointerId);
  }
  function cancel() {
    if (controller.current) return;
    setFile(null);
    setSource(null);
    prepared.current = null;
    pointers.current.clear();
    setError('');
  }
  async function upload(event: FormEvent) {
    event.preventDefault();
    if (!image || controller.current) return;
    pointers.current.clear();
    setBusy(true);
    setProgress({ phase: 'preparing' });
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
        onUploadProgress: (percent) => {
          if (!request.signal.aborted)
            setProgress({
              phase: percent === 100 ? 'processing' : 'uploading',
              percent,
            });
        },
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
          {onboarding ? 'Add profile photo' : 'Change photo'}
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
            pointers.current.clear();
            setError('');
            setMessage('');
          }}
        />
        <p id="avatar-file-help" className="avatar-help">
          JPEG, PNG, or WebP. Up to 32 MB and 40 megapixels. Photos are resized
          automatically before upload.
          <br />
          Visible to signed-in members.
        </p>
      </div>
      {message && <p role="status">{message}</p>}
      {file && (
        <Dialog
          title="Crop profile photo"
          busy={busy}
          announceWhileBusy
          onClose={cancel}
        >
          <form onSubmit={(event) => void upload(event)}>
            {file && !image && !error && (
              <PhotoProgress progress={{ phase: 'opening' }} />
            )}
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
                  onPointerDown={startGesture}
                  onPointerMove={moveGesture}
                  onPointerUp={endGesture}
                  onPointerCancel={endGesture}
                  onLostPointerCapture={endGesture}
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
                  Drag to position the photo. Pinch or use the slider to zoom.
                  Arrow keys also move the photo.
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
            {busy && <PhotoProgress progress={progress} />}
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
                {busy ? 'Saving…' : error ? 'Retry save' : 'Use photo'}
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </section>
  );
}
