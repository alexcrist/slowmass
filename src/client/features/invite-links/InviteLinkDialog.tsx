import { useEffect, useState } from 'react';
import { api } from '../../api';
import { Dialog } from '../../ui/Dialog';
import { CopyLink } from '../../ui/CopyLink';

type Link = { url: string };

// Opening refreshes a current link to seven days, or issues a new version
// after expiry/revocation. The server owns that lifetime.
export function InviteLinkDialog({ onClose }: { onClose: () => void }) {
  const [link, setLink] = useState<Link | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    api<Link>('/api/invite-link', {
      method: 'POST',
      signal: controller.signal,
    })
      .then((value) => {
        if (!controller.signal.aborted) setLink(value);
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted)
          setError(
            failure instanceof Error
              ? failure.message
              : 'Could not get your invite link. Try again.',
          );
      });
    return () => controller.abort();
  }, [attempt]);
  return (
    <Dialog title="Invite link" onClose={onClose}>
      {link ? (
        <>
          <p>
            Send the link to your friends to invite them to slowmass. This link
            works for the next 7 days.
          </p>
          <CopyLink url={link.url} label="Invite link" />
        </>
      ) : error ? (
        <>
          <p role="alert">{error}</p>
          <button
            type="button"
            onClick={() => {
              setError('');
              setAttempt((value) => value + 1);
            }}
          >
            Try again
          </button>
        </>
      ) : (
        <p role="status">Loading your invite link…</p>
      )}
    </Dialog>
  );
}
