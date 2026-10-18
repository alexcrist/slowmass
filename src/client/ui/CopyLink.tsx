import { useState } from 'react';

// A link with a Copy button. When the clipboard is unavailable, the field
// selects itself so the link can be copied by hand.
export function CopyLink({ url, label }: { url: string; label: string }) {
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
    <>
      <div className="link-copy">
        <input
          readOnly
          aria-label={label}
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
    </>
  );
}
