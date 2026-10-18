import { useState } from 'react';
import { Dialog } from '../../ui/Dialog';

// The event's one URL with a copy button. When the clipboard is unavailable,
// the field selects itself so the link can be copied by hand.
export function EventLinkDialog({
  url,
  onClose,
}: {
  url: string;
  onClose: () => void;
}) {
  const [status, setStatus] = useState('');
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setStatus('Link copied.');
    } catch {
      setStatus('Couldn’t copy the link. Select it and copy it instead.');
    }
  }
  return (
    <Dialog title="Event link" onClose={onClose}>
      <p>Send the link to your friends to invite them.</p>
      <div className="event-link-copy">
        <input
          readOnly
          aria-label="Event link"
          value={url}
          onFocus={(focus) => focus.target.select()}
        />
        <button
          type="button"
          className="primary-button"
          onClick={() => void copy()}
        >
          Copy
        </button>
      </div>
      {status && <p role="status">{status}</p>}
    </Dialog>
  );
}
