import { useId, useLayoutEffect, useRef, useState } from 'react';
import { overflowMenuPosition } from './overflow-menu-position';

type Item = { label: string; onSelect: () => void; danger?: boolean };

function focusChoice(
  panel: HTMLDivElement | null,
  choice: HTMLButtonElement | null | undefined,
) {
  choice?.focus({ preventScroll: true });
  if (!panel || !choice) return;
  if (choice.offsetTop < panel.scrollTop) panel.scrollTop = choice.offsetTop;
  else if (
    choice.offsetTop + choice.offsetHeight >
    panel.scrollTop + panel.clientHeight
  ) {
    panel.scrollTop =
      choice.offsetTop + choice.offsetHeight - panel.clientHeight;
  }
}
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
  const menu = useRef<HTMLDivElement>(null);
  const choices = useRef<(HTMLButtonElement | null)[]>([]);
  const openingIndex = useRef(0);
  // Callers recreate callbacks on render; only changes to available choices
  // invalidate an open menu, not callback identity or unrelated refreshes.
  const configuration = JSON.stringify([
    label,
    items.map(({ label, danger }) => [label, Boolean(danger)]),
  ]);
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  const available = !disabled && items.length > 0;
  const open = available && openedFor === configuration;
  if (openedFor !== null && !open) setOpenedFor(null);
  useLayoutEffect(() => {
    if (!open) return;
    const panel = menu.current;
    const container = root.current;
    const button = trigger.current;
    if (!panel || !container || !button) return;
    const viewport = window.visualViewport;
    const left = (viewport?.offsetLeft ?? 0) + 8;
    const top = (viewport?.offsetTop ?? 0) + 8;
    const right =
      left + (viewport?.width ?? document.documentElement.clientWidth) - 16;
    let bottom = top + (viewport?.height ?? window.innerHeight) - 16;
    // The mobile bar includes the device safe-area inset in its measured height.
    if (window.matchMedia('(max-width: 899px)').matches) {
      const navigation = document
        .querySelector('.app-navigation')
        ?.getBoundingClientRect();
      if (navigation) bottom = Math.min(bottom, navigation.top - 8);
    }
    bottom = Math.max(top, bottom);
    panel.style.maxWidth = `${Math.max(0, right - left)}px`;
    panel.style.minWidth = `${Math.max(0, Math.min(168, right - left))}px`;
    const placement = overflowMenuPosition(
      button.getBoundingClientRect(),
      panel.getBoundingClientRect(),
      { left, right, top, bottom },
    );
    const origin = container.getBoundingClientRect();
    panel.style.left = `${placement.left - origin.left}px`;
    panel.style.top = `${placement.top - origin.top}px`;
    panel.style.maxHeight = `${placement.maxHeight}px`;
    focusChoice(panel, choices.current[openingIndex.current]);

    function dismissOutside(event: Event) {
      if (!container?.contains(event.target as Node)) setOpenedFor(null);
    }
    function dismissViewport() {
      if (panel?.contains(document.activeElement) && !button?.disabled) {
        button?.focus({ preventScroll: true });
      }
      setOpenedFor(null);
    }
    function dismissScroll(event: Event) {
      // Arrow-key focus and touch scrolling inside a constrained menu are valid.
      if (event.target === window || !panel?.contains(event.target as Node))
        dismissViewport();
    }
    document.addEventListener('pointerdown', dismissOutside);
    document.addEventListener('focusin', dismissOutside);
    window.addEventListener('scroll', dismissScroll, true);
    window.addEventListener('resize', dismissViewport);
    window.addEventListener('hashchange', dismissViewport);
    viewport?.addEventListener('resize', dismissViewport);
    viewport?.addEventListener('scroll', dismissViewport);
    return () => {
      document.removeEventListener('pointerdown', dismissOutside);
      document.removeEventListener('focusin', dismissOutside);
      window.removeEventListener('scroll', dismissScroll, true);
      window.removeEventListener('resize', dismissViewport);
      window.removeEventListener('hashchange', dismissViewport);
      viewport?.removeEventListener('resize', dismissViewport);
      viewport?.removeEventListener('scroll', dismissViewport);
    };
  }, [open]);
  function close() {
    setOpenedFor(null);
    trigger.current?.focus({ preventScroll: true });
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
        disabled={!available}
        onClick={() => {
          openingIndex.current = 0;
          setOpenedFor(open ? null : configuration);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            openingIndex.current =
              event.key === 'ArrowUp' ? items.length - 1 : 0;
            if (open)
              focusChoice(menu.current, choices.current[openingIndex.current]);
            else setOpenedFor(configuration);
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
          ref={menu}
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
              focusChoice(menu.current, choices.current[next]);
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
