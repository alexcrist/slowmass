import type { ReactNode } from 'react';
import { Dialog } from './Dialog';

export function ConfirmDialog({
  title,
  confirmLabel,
  busy,
  error,
  danger = false,
  onClose,
  onConfirm,
  children,
}: {
  title: string;
  confirmLabel: string;
  busy: boolean;
  error: string;
  danger?: boolean;
  onClose: () => void;
  onConfirm: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog title={title} busy={busy} onClose={onClose}>
      {children}
      {error && <p role="alert">{error}</p>}
      <div className="dialog-actions">
        <button type="button" disabled={busy} onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className={danger ? 'danger-button' : 'primary-button'}
          disabled={busy}
          onClick={onConfirm}
        >
          {busy ? 'Saving…' : confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}
