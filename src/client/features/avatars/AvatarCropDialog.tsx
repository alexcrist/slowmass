import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent,
} from 'react';
import { PhotoProgress } from '../../images/PhotoProgress';
import { Dialog } from '../../ui/Dialog';
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

export type PreparedAvatar = { id: string; blob: Blob };

// Crops a chosen file into a prepared avatar. The idempotency key is created
// with the bytes, so a parent that retries the upload resends the same pair.
export function AvatarCropDialog({
  file,
  onClose,
  onSelect,
}: {
  file: File;
  onClose: () => void;
  onSelect: (photo: PreparedAvatar) => void;
}) {
  const [decoded, setDecoded] = useState<{
    file: File;
    image: ImageBitmap;
  } | null>(null);
  const image = decoded?.file === file ? decoded.image : null;
  const [crop, setCrop] = useState(initialCrop);
  const [error, setError] = useState('');
  // Another file starts over with a fresh crop; its effect drops held pointers.
  const [cropped, setCropped] = useState(file);
  if (cropped !== file) {
    setCropped(file);
    setCrop(initialCrop);
    setError('');
  }
  const [busy, setBusy] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const pointers = useRef(new Map<number, CropPoint>());
  const active = useRef(true);
  // Set synchronously, so a second confirmation or gesture in the same event
  // can't slip in before the busy state renders.
  const preparing = useRef(false);

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    let current = true;
    let bitmap: ImageBitmap | undefined;
    pointers.current.clear();
    void decodePhoto(file)
      .then((result) => {
        bitmap = result;
        if (current) setDecoded({ file, image: result });
        else result.close();
      })
      .catch((failure: unknown) => {
        if (current)
          setError(
            failure instanceof Error
              ? failure.message
              : 'Could not open photo.',
          );
      });
    return () => {
      current = false;
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
    setError('');
  }
  function startGesture(event: PointerEvent<HTMLCanvasElement>) {
    if (preparing.current || event.button !== 0 || pointers.current.size >= 2)
      return;
    const point = pointerPosition(event);
    if (!point) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, point);
  }
  function moveGesture(event: PointerEvent<HTMLCanvasElement>) {
    if (preparing.current || !image || !pointers.current.has(event.pointerId))
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
  async function use(event: FormEvent) {
    event.preventDefault();
    if (!image || preparing.current) return;
    preparing.current = true;
    pointers.current.clear();
    setBusy(true);
    setError('');
    try {
      const blob = await encodeCrop(image, crop);
      if (active.current) onSelect({ id: crypto.randomUUID(), blob });
    } catch (failure) {
      if (active.current)
        setError(
          failure instanceof Error ? failure.message : 'Could not crop photo.',
        );
    } finally {
      preparing.current = false;
      if (active.current) setBusy(false);
    }
  }
  return (
    <Dialog
      title="Crop profile photo"
      busy={busy}
      announceWhileBusy
      onClose={onClose}
    >
      <form onSubmit={(event) => void use(event)}>
        {!image && !error && <PhotoProgress progress={{ phase: 'opening' }} />}
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
                  moveCrop(image.width, image.height, crop, delta[0], delta[1]),
                );
              }}
            />
            <p id="avatar-crop-help" className="status-copy">
              Drag to position the photo. Pinch or use the slider to zoom. Arrow
              keys also move the photo.
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
        {busy && <PhotoProgress progress={{ phase: 'preparing' }} />}
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
            onClick={onClose}
          >
            Cancel
          </button>
          <button className="primary-button" disabled={busy || !image}>
            {busy ? 'Preparing…' : 'Use photo'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
