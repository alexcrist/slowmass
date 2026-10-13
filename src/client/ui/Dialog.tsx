import {
  useEffect,
  useId,
  useRef,
  type ReactNode,
  type MouseEvent,
} from 'react';

export function Dialog({
  title,
  onClose,
  busy = false,
  wide = false,
  appearance = 'panel',
  children,
}: {
  title: string;
  onClose: () => void;
  busy?: boolean;
  wide?: boolean;
  appearance?: 'panel' | 'image';
  children: ReactNode;
}) {
  const id = useId();
  const ref = useRef<HTMLDialogElement>(null);
  const backdropPress = useRef(false);
  function onBackdrop(event: MouseEvent<HTMLDialogElement>) {
    if (event.target !== event.currentTarget) return false;
    const bounds = event.currentTarget.getBoundingClientRect();
    return (
      event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom
    );
  }
  useEffect(() => {
    const dialog = ref.current;
    const trigger = document.activeElement as HTMLElement | null;
    const style = document.body?.style;
    const overflow = style?.overflow ?? '';
    if (style) style.overflow = 'hidden';
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (style) style.overflow = overflow;
      if (trigger?.isConnected) trigger.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`app-dialog${wide ? ' app-dialog-wide' : ''}${appearance === 'image' ? ' app-dialog-image' : ''}`}
      aria-labelledby={id}
      aria-busy={busy}
      onPointerDown={(event) => {
        backdropPress.current = event.button === 0 && onBackdrop(event);
      }}
      onPointerCancel={() => {
        backdropPress.current = false;
      }}
      onClick={(event) => {
        const dismiss = backdropPress.current && onBackdrop(event);
        backdropPress.current = false;
        if (dismiss && !busy) onClose();
      }}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="dialog-heading">
        <h2
          id={id}
          className={appearance === 'image' ? 'visually-hidden' : undefined}
        >
          {title}
        </h2>
        <button
          type="button"
          className="icon-button"
          aria-label={`Close ${title.toLowerCase()}`}
          disabled={busy}
          onClick={onClose}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            aria-hidden="true"
          >
            <path d="m6 6 12 12M18 6 6 18" />
          </svg>
        </button>
      </div>
      {children}
    </dialog>
  );
}
