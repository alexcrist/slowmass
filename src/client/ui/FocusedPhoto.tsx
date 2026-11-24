import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type ReactElement,
  type TouchList,
} from 'react';
import { Dialog } from './Dialog';
import { ViewerImage } from './ImageViewer';

type Point = { x: number; y: number };
type Frame = Point & { scale: number };
type Gesture = Point & { distance: number };

function fingers(touches: TouchList): Gesture | null {
  const [a, b] = Array.from(touches);
  if (!a) return null;
  if (!b) return { x: a.clientX, y: a.clientY, distance: 0 };
  return {
    x: (a.clientX + b.clientX) / 2,
    y: (a.clientY + b.clientY) / 2,
    distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
  };
}

function fit(width: number, height: number) {
  return Math.min(window.innerWidth / width, window.innerHeight / height);
}
function centered(width: number, height: number, zoom: number): Frame {
  const scale = fit(width, height) * zoom;
  return {
    scale,
    x: (window.innerWidth - width * scale) / 2,
    y: (window.innerHeight - height * scale) / 2,
  };
}

// Limit a pan to the photo edges. An inline pinch can start partway outside
// the viewport, so allow that starting position until the user moves inward.
function bounded(
  position: number,
  previous: number,
  viewport: number,
  size: number,
) {
  const gap = viewport - size;
  return Math.max(
    Math.min(0, gap, previous),
    Math.min(Math.max(0, gap, previous), position),
  );
}

export function FocusedPhoto({
  children,
  title,
  triggerLabel,
  triggerClass,
  openingZoom,
  ...photo
}: {
  title: string;
  triggerLabel: string;
  triggerClass: string;
  openingZoom: number;
  src: string;
  alt: string;
  width: number;
  height: number;
  children: ReactElement;
}) {
  const trigger = useRef<HTMLButtonElement>(null);

  const stage = useRef<HTMLDivElement>(null);
  const backdropPress = useRef<Point | null>(null);
  const lastTap = useRef<(Point & { time: number }) | null>(null);
  const tapStart = useRef<(Point & { time: number }) | null>(null);
  const trackpadScale = useRef(1);
  const previous = useRef<Gesture | null>(null);
  const mouse = useRef<Point | null>(null);
  const [frame, setFrame] = useState<Frame | null>(null);
  function inlineFrame() {
    const image = trigger.current?.querySelector('img');
    if (!image) return centered(photo.width, photo.height, openingZoom);
    const rect = image.getBoundingClientRect();
    const scale = Math.min(
      image.clientWidth / photo.width,
      image.clientHeight / photo.height,
    );
    return {
      scale,
      x: rect.left + (rect.width - photo.width * scale) / 2,
      y: rect.top + (rect.height - photo.height * scale) / 2,
    };
  }
  function move(from: Point, to: Point, ratio: number) {
    const base = frame ?? inlineFrame();
    const fitted = fit(photo.width, photo.height);
    setFrame((current) => {
      const f = current ?? base;
      const scale = Math.min(
        Math.max(fitted * 8, f.scale),
        Math.max(Math.min(fitted, f.scale), f.scale * ratio),
      );
      return {
        scale,
        x: bounded(
          to.x - (from.x - f.x) * (scale / f.scale),
          f.x,
          window.innerWidth,
          photo.width * scale,
        ),
        y: bounded(
          to.y - (from.y - f.y) * (scale / f.scale),
          f.y,
          window.innerHeight,
          photo.height * scale,
        ),
      };
    });
  }
  function start(touches: TouchList) {
    previous.current = fingers(touches);
    if (!frame && touches.length === 2) setFrame(inlineFrame());
  }
  function drag(touches: TouchList) {
    const now = fingers(touches),
      last = previous.current;
    if (now && last && (frame || now.distance))
      move(
        last,
        now,
        last.distance && now.distance ? now.distance / last.distance : 1,
      );
    previous.current = now;
  }
  function step(ratio: number) {
    const center = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    move(center, center, ratio);
  }
  function close() {
    backdropPress.current = null;
    previous.current = null;
    mouse.current = null;
    lastTap.current = tapStart.current = null;
    setFrame(null);
    trigger.current?.focus({ preventScroll: true });
  }
  const open = frame !== null;
  useEffect(() => {
    if (!open) return;
    const resize = () => {
      setFrame(centered(photo.width, photo.height, openingZoom));
    };
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [open, photo.width, photo.height, openingZoom]);
  const touchHandlers = {
    onTouchStart: (e: React.TouchEvent) => start(e.touches),
    onTouchMove: (e: React.TouchEvent) => drag(e.touches),
    onTouchEnd: (e: React.TouchEvent) => {
      previous.current = fingers(e.touches);
    },
    onTouchCancel: () => {
      previous.current = null;
    },
  };
  function wheel(e: React.WheelEvent) {
    if (!open && !e.ctrlKey) return;
    const point = { x: e.clientX, y: e.clientY };
    const unit =
      e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1;
    move(point, point, Math.exp(-e.deltaY * unit * (e.ctrlKey ? 0.01 : 0.002)));
  }
  // Safari trackpads send cumulative gesture scales. Touchscreens already
  // supply the individual contacts used by the touch handlers above.
  const safariPinch = useEffectEvent((event: Event) => {
    if (
      previous.current ||
      !(
        'clientX' in event &&
        typeof event.clientX === 'number' &&
        'clientY' in event &&
        typeof event.clientY === 'number'
      ) ||
      !('scale' in event) ||
      typeof event.scale !== 'number' ||
      event.scale <= 0
    )
      return;
    event.preventDefault();
    const point = { x: event.clientX, y: event.clientY };
    if (event.type === 'gesturestart') trackpadScale.current = 1;
    move(point, point, event.scale / trackpadScale.current);
    trackpadScale.current = event.scale;
  });
  useEffect(() => {
    if (!('GestureEvent' in window)) return;
    const surfaces = [trigger.current, stage.current];
    const handle = (event: Event) => safariPinch(event);
    for (const surface of surfaces) {
      surface?.addEventListener('gesturestart', handle);
      surface?.addEventListener('gesturechange', handle);
    }
    return () => {
      for (const surface of surfaces) {
        surface?.removeEventListener('gesturestart', handle);
        surface?.removeEventListener('gesturechange', handle);
      }
    };
  }, [open]);
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={triggerClass}
        aria-label={triggerLabel}
        aria-haspopup="dialog"
        aria-expanded={!!frame}
        {...touchHandlers}
        onWheel={wheel}
        onClick={() =>
          setFrame(
            (current) =>
              current ?? centered(photo.width, photo.height, openingZoom),
          )
        }
      >
        {children}
      </button>
      {frame && (
        <Dialog title={title} appearance="image" onClose={close}>
          <div
            ref={stage}
            className="photo-zoom-stage"
            onTouchStart={(e) => {
              start(e.touches);
              const point = previous.current;
              tapStart.current =
                e.touches.length === 1 &&
                point &&
                e.target instanceof HTMLImageElement
                  ? { ...point, time: e.timeStamp }
                  : null;
              if (!tapStart.current) lastTap.current = null;
            }}
            onTouchMove={(e) => {
              drag(e.touches);
              const point = previous.current;
              const tap = tapStart.current;
              if (
                tap &&
                point &&
                Math.hypot(point.x - tap.x, point.y - tap.y) > 12
              )
                lastTap.current = tapStart.current = null;
            }}
            onTouchCancel={() => {
              previous.current = lastTap.current = tapStart.current = null;
            }}
            onTouchEnd={(e) => {
              previous.current = fingers(e.touches);
              const tap = tapStart.current;
              tapStart.current = null;
              if (!tap || e.touches.length || e.timeStamp - tap.time > 300) {
                lastTap.current = null;
                return;
              }
              const last = lastTap.current;
              if (
                last &&
                e.timeStamp - last.time <= 350 &&
                Math.hypot(tap.x - last.x, tap.y - last.y) <= 30
              ) {
                setFrame(centered(photo.width, photo.height, 1));
                lastTap.current = null;
              } else {
                lastTap.current = { ...tap, time: e.timeStamp };
              }
            }}
            onDoubleClick={(e) => {
              if (e.target instanceof HTMLImageElement)
                setFrame(centered(photo.width, photo.height, 1));
            }}
            onWheel={wheel}
            onPointerDown={(e) => {
              const background =
                e.target === e.currentTarget ||
                (e.target instanceof Element &&
                  e.target.classList.contains('image-viewer'));
              backdropPress.current =
                background && e.isPrimary && e.button === 0
                  ? { x: e.clientX, y: e.clientY }
                  : null;
              if (
                background ||
                e.pointerType === 'touch' ||
                e.button !== 0 ||
                !(e.target instanceof HTMLImageElement)
              )
                return;
              e.currentTarget.setPointerCapture(e.pointerId);
              mouse.current = { x: e.clientX, y: e.clientY };
            }}
            onPointerMove={(e) => {
              const press = backdropPress.current;
              if (
                press &&
                Math.hypot(e.clientX - press.x, e.clientY - press.y) > 6
              )
                backdropPress.current = null;
              if (mouse.current && e.pointerType !== 'touch') {
                const next = { x: e.clientX, y: e.clientY };
                move(mouse.current, next, 1);
                mouse.current = next;
              }
            }}
            onPointerCancel={() => {
              backdropPress.current = null;
            }}
            onClick={(e) => {
              const press = backdropPress.current;
              backdropPress.current = null;
              if (
                press &&
                Math.hypot(e.clientX - press.x, e.clientY - press.y) <= 6 &&
                (e.target === e.currentTarget ||
                  (e.target instanceof Element &&
                    e.target.classList.contains('image-viewer')))
              )
                close();
            }}
            tabIndex={0}
            aria-label="Photo viewer. Use plus and minus to zoom and arrow keys to pan."
            role="group"
            onLostPointerCapture={() => {
              mouse.current = null;
            }}
            onKeyDown={(e) => {
              const offsets: Record<string, Point> = {
                ArrowLeft: { x: 40, y: 0 },
                ArrowRight: { x: -40, y: 0 },
                ArrowUp: { x: 0, y: 40 },
                ArrowDown: { x: 0, y: -40 },
              };
              if (['+', '=', '-'].includes(e.key)) {
                e.preventDefault();
                step(e.key === '-' ? 0.8 : 1.25);
              }
              if (offsets[e.key]) {
                e.preventDefault();
                move({ x: 0, y: 0 }, offsets[e.key], 1);
              }
            }}
          >
            <ViewerImage
              title={title}
              {...photo}
              style={{
                width: photo.width,
                height: photo.height,
                transform: `translate3d(${frame.x}px,${frame.y}px,0) scale(${frame.scale})`,
              }}
            />
          </div>
        </Dialog>
      )}
    </>
  );
}
