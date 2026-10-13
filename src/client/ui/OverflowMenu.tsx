import { useEffect, useId, useRef, useState } from 'react';

type Item = { label: string; onSelect: () => void; danger?: boolean };
export function OverflowMenu({
  label,
  items,
  disabled = false,
}: {
  label: string;
  items: Item[];
  disabled?: boolean;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const choices = useRef<(HTMLButtonElement | null)[]>([]);
  const openingIndex = useRef(0);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    choices.current[openingIndex.current]?.focus();
    function dismiss(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);
  function close() {
    setOpen(false);
    trigger.current?.focus();
  }
  return (
    <div className="overflow-menu-container" ref={root}>
      <button
        ref={trigger}
        type="button"
        className="icon-button"
        aria-label={label}
        aria-haspopup="menu"
        aria-controls={open ? id : undefined}
        aria-expanded={open}
        disabled={disabled || items.length === 0}
        onClick={() => {
          openingIndex.current = 0;
          setOpen(!open);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            openingIndex.current =
              event.key === 'ArrowUp' ? items.length - 1 : 0;
            if (open) choices.current[openingIndex.current]?.focus();
            else setOpen(true);
          }
        }}
      >
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="12" cy="5" r="1.7" />
          <circle cx="12" cy="12" r="1.7" />
          <circle cx="12" cy="19" r="1.7" />
        </svg>
      </button>
      {open && (
        <div
          id={id}
          className="overflow-menu"
          role="menu"
          aria-label={label}
          onKeyDown={(event) => {
            if (event.key === 'Escape' || event.key === 'Tab') {
              if (event.key === 'Escape') event.preventDefault();
              close();
              return;
            }
            const current = choices.current.findIndex(
              (button) => button === document.activeElement,
            );
            const next =
              event.key === 'ArrowDown'
                ? (current + 1) % items.length
                : event.key === 'ArrowUp'
                  ? (current + items.length - 1) % items.length
                  : event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? items.length - 1
                      : null;
            if (next !== null) {
              event.preventDefault();
              choices.current[next]?.focus();
            }
          }}
        >
          {items.map((item, index) => (
            <button
              key={item.label}
              ref={(node) => {
                choices.current[index] = node;
              }}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className={item.danger ? 'danger-action' : undefined}
              onClick={() => {
                close();
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
