import {
  useEffect,
  useId,
  useRef,
  useState,
  type PointerEvent,
  type KeyboardEvent,
} from 'react';
import { Dialog } from '../../ui/Dialog';
import { decodePhoto } from '../../images/decode';
import {
  adjustRectangle,
  encodePostCrop,
  fullPhoto,
  pixelRectangle,
  type Rectangle,
  type CropHandle,
} from './crop';

const handles = [
  ['nw', 'top left', 0, 0],
  ['n', 'top', 50, 0],
  ['ne', 'top right', 100, 0],
  ['w', 'left', 0, 50],
  ['e', 'right', 100, 50],
  ['sw', 'bottom left', 0, 100],
  ['s', 'bottom', 50, 100],
  ['se', 'bottom right', 100, 100],
] as const;

export function PostCropEditor({
  file,
  initial,
  onApply,
  onClose,
}: {
  file: File;
  initial: Rectangle;
  onApply: (file: File, crop: Rectangle) => void;
  onClose: () => void;
}) {
  const help = useId();
  const [image, setImage] = useState<ImageBitmap | null>(null);
  const [crop, setCrop] = useState(initial);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const saving = useRef(false);
  const active = useRef(false);
  const drag = useRef<{
    id: number;
    handle: CropHandle;
    x: number;
    y: number;
  } | null>(null);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    let current = true;
    let bitmap: ImageBitmap | undefined;
    void decodePhoto(file)
      .then((decoded) => {
        bitmap = decoded;
        if (current) setImage(decoded);
        else decoded.close();
      })
      .catch((failure: unknown) => {
        if (current)
          setError(
            failure instanceof Error
              ? failure.message
              : 'Could not open this photo.',
          );
      });
    return () => {
      current = false;
      bitmap?.close();
    };
  }, [file, attempt]);
  useEffect(() => {
    if (!image || !canvas.current) return;
    try {
      const context = canvas.current.getContext('2d');
      if (!context)
        throw new Error('Photo cropping is unavailable in this browser.');
      context.drawImage(
        image,
        0,
        0,
        canvas.current.width,
        canvas.current.height,
      );
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Could not show this photo.',
      );
    }
  }, [image]);
  function start(event: PointerEvent<HTMLButtonElement>, handle: CropHandle) {
    if (saving.current || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      id: event.pointerId,
      handle,
      x: event.clientX,
      y: event.clientY,
    };
  }
  function move(event: PointerEvent<HTMLButtonElement>) {
    const previous = drag.current;
    const bounds = stage.current?.getBoundingClientRect();
    if (
      !previous ||
      previous.id !== event.pointerId ||
      !bounds?.width ||
      !bounds.height ||
      saving.current
    )
      return;
    const dx = (event.clientX - previous.x) / bounds.width;
    const dy = (event.clientY - previous.y) / bounds.height;
    setCrop((current) => adjustRectangle(current, previous.handle, dx, dy));
    drag.current = { ...previous, x: event.clientX, y: event.clientY };
  }
  function keys(event: KeyboardEvent<HTMLButtonElement>, handle: CropHandle) {
    const delta = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    }[event.key];
    if (!delta || saving.current) return;
    event.preventDefault();
    const step = event.shiftKey ? 0.1 : 0.01;
    setCrop((current) =>
      adjustRectangle(current, handle, delta[0] * step, delta[1] * step),
    );
  }
  function stop() {
    drag.current = null;
  }
  async function apply() {
    if (!image || saving.current) return;
    saving.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await encodePostCrop(image, crop);
      if (active.current) onApply(result, crop);
    } catch (failure) {
      if (active.current)
        setError(
          failure instanceof Error
            ? failure.message
            : 'Could not save this crop.',
        );
    } finally {
      saving.current = false;
      if (active.current) setBusy(false);
    }
  }
  const pixels = image ? pixelRectangle(image.width, image.height, crop) : null;
  const scale = image
    ? Math.min(1, 720 / Math.max(image.width, image.height))
    : 1;
  const selectionStyle = {
    left: `${crop.left * 100}%`,
    top: `${crop.top * 100}%`,
    width: `${(crop.right - crop.left) * 100}%`,
    height: `${(crop.bottom - crop.top) * 100}%`,
  };
  return (
    <Dialog
      title="Crop photo"
      wide
      busy={busy}
      onClose={() => {
        if (!saving.current) onClose();
      }}
    >
      {!image && !error && <p role="status">Opening photo…</p>}
      {image && (
        <>
          <p id={help} className="status-copy">
            Drag the corners or edges to change the shape. Drag inside to move
            the crop. Arrow keys also work; hold Shift for larger adjustments.
          </p>
          <div
            className="post-crop-stage"
            ref={stage}
            style={{
              width: `min(calc(100% - 44px), ${(55 * image.width) / image.height}svh)`,
            }}
          >
            <canvas
              ref={canvas}
              width={Math.max(1, Math.round(image.width * scale))}
              height={Math.max(1, Math.round(image.height * scale))}
              role="img"
              aria-label="Photo with an adjustable crop rectangle"
            />
            <div className="post-crop-mask" aria-hidden="true">
              <div className="post-crop-window" style={selectionStyle} />
            </div>
            <div className="post-crop-selection" style={selectionStyle}>
              <button
                type="button"
                disabled={busy}
                aria-describedby={help}
                onPointerDown={(event) => start(event, 'move')}
                onPointerMove={move}
                onPointerUp={stop}
                onPointerCancel={stop}
                onLostPointerCapture={stop}
                onKeyDown={(event) => keys(event, 'move')}
                className="post-crop-move"
                aria-label="Move crop"
              />
              {handles.map(([handle, label, left, top]) => (
                <button
                  key={handle}
                  type="button"
                  disabled={busy}
                  aria-describedby={help}
                  onPointerDown={(event) => start(event, handle)}
                  onPointerMove={move}
                  onPointerUp={stop}
                  onPointerCancel={stop}
                  onLostPointerCapture={stop}
                  onKeyDown={(event) => keys(event, handle)}
                  className="post-crop-handle"
                  aria-label={`Resize crop from ${label}`}
                  style={{
                    left: `${left}%`,
                    top: `${top}%`,
                    cursor: `${handle}-resize`,
                  }}
                />
              ))}
            </div>
          </div>
          <div className="post-crop-tools">
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => setCrop(fullPhoto)}
            >
              Reset crop
            </button>
            <output aria-live="off">
              {pixels?.width} × {pixels?.height}
            </output>
          </div>
        </>
      )}
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      {error && !image && (
        <button
          type="button"
          onClick={() => {
            setError('');
            setAttempt(attempt + 1);
          }}
        >
          Retry
        </button>
      )}
      <div className="dialog-actions">
        <button type="button" disabled={busy} onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="primary-button"
          disabled={busy || !image}
          onClick={() => void apply()}
        >
          {busy ? 'Saving…' : 'Use photo'}
        </button>
      </div>
    </Dialog>
  );
}
