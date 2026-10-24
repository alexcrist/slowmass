import { useId, type FormEvent } from 'react';
import { useViewer } from './Viewer';

// The member's avatar beside a filled text box that grows with its draft,
// ending in a Post button that is enabled while the draft can be submitted.
export function Composer({
  label,
  placeholder,
  maxLength,
  value,
  busy,
  canSubmit,
  submitLabel,
  pendingLabel,
  onChange,
  onSubmit,
}: {
  label: string;
  placeholder: string;
  maxLength: number;
  value: string;
  busy: boolean;
  canSubmit: boolean;
  submitLabel: string;
  pendingLabel: string;
  onChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  const id = useId();
  const viewer = useViewer();
  return (
    <form className="composer" onSubmit={onSubmit}>
      {viewer &&
        (viewer.avatar ? (
          <img
            className="composer-avatar"
            src={viewer.avatar}
            width={32}
            height={32}
            alt=""
          />
        ) : (
          <span className="composer-avatar" aria-hidden="true">
            {viewer.displayName.trim().charAt(0).toUpperCase()}
          </span>
        ))}
      <div className="composer-field">
        <label className="visually-hidden" htmlFor={id}>
          {label}
        </label>
        <div className="composer-input">
          <span className="composer-size" aria-hidden="true">
            {value + ' '}
          </span>
          <textarea
            id={id}
            required
            maxLength={maxLength}
            rows={1}
            placeholder={placeholder}
            value={value}
            disabled={busy}
            onChange={(change) => onChange(change.target.value)}
          />
        </div>
        <button
          className="composer-submit"
          type="submit"
          disabled={busy || !canSubmit || !value.trim()}
          aria-label={busy ? pendingLabel : submitLabel}
        >
          Post
        </button>
      </div>
    </form>
  );
}
