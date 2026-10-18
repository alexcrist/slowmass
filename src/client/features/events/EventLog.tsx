import { useId, useState, type FormEvent } from 'react';
import { api, jsonRequest } from '../../api';
import { useApiResource } from '../../api/useApiResource';
import { usePageHistory } from '../../navigation/PageHistory';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { RelativeTime } from '../../ui/RelativeTime';
import { PersonPhoto } from './EventSummary';
import { GuestName, guestPhoto } from './EventGuests';
import type { Answer } from './types';

type Entry = {
  key: string;
  kind: 'response' | 'message' | 'changed' | 'cancelled';
  id: string | null;
  status: Answer | null;
  body: string;
  createdAt: number;
  handle: string;
  displayName: string;
  hasAvatar: boolean;
  canDelete: boolean;
};

export function changedText(fields: string) {
  return fields === 'time,location'
    ? 'the time and location'
    : fields === 'location'
      ? 'the location'
      : 'the time';
}
function entryText(entry: Entry) {
  if (entry.kind === 'response')
    return entry.status === 'going'
      ? ' is going.'
      : entry.status === 'maybe'
        ? ' might go.'
        : ' can’t go.';
  if (entry.kind === 'changed') return ` changed ${changedText(entry.body)}.`;
  if (entry.kind === 'cancelled') return ' cancelled the event.';
  return ' ';
}

// Answers and messages, newest first, with a composer for hosts and guests.
export function EventLog({
  id,
  linkProfiles,
  onPosted,
}: {
  id: string;
  linkProfiles: boolean;
  onPosted?: () => void;
}) {
  const label = useId();
  const [history, setHistory] = usePageHistory(`event/${id}/activity`);
  const cursor = history[history.length - 1];
  const { data, error, loading, reload, refresh } = useApiResource<{
    items: Entry[];
    next: string | null;
  }>(
    `/api/events/${id}/activity${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
  );
  const [body, setBody] = useState('');
  const [messageId, setMessageId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const [deleting, setDeleting] = useState<Entry | null>(null);
  async function post(submit: FormEvent) {
    submit.preventDefault();
    if (busy || !body.trim()) return;
    setBusy(true);
    setFailure('');
    try {
      await api(
        `/api/events/${id}/messages`,
        jsonRequest('POST', { id: messageId, body }),
      );
      setBody('');
      setMessageId(crypto.randomUUID());
      if (history.length > 1) setHistory(['']);
      else refresh();
      onPosted?.();
    } catch (error) {
      setFailure(
        error instanceof Error ? error.message : 'Could not post the message.',
      );
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!deleting?.id) return;
    setBusy(true);
    setFailure('');
    try {
      await api(`/api/events/${id}/messages/${deleting.id}`, {
        method: 'DELETE',
      });
      refresh((page) => ({
        ...page,
        items: page.items.filter((entry) => entry.key !== deleting.key),
      }));
      setDeleting(null);
    } catch (error) {
      setFailure(
        error instanceof Error ? error.message : 'Could not delete message.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <form
        className="comment-composer"
        onSubmit={(submit) => void post(submit)}
      >
        <label className="visually-hidden" htmlFor={label}>
          Write a message
        </label>
        <div className="comment-input">
          <span className="comment-input-size" aria-hidden="true">
            {body + ' '}
          </span>
          <textarea
            id={label}
            required
            maxLength={2000}
            rows={1}
            placeholder="Write a message…"
            value={body}
            disabled={busy}
            onChange={(change) => {
              setBody(change.target.value);
              setMessageId(crypto.randomUUID());
            }}
          />
        </div>
        <button
          className="comment-submit"
          type="submit"
          disabled={busy || !body.trim()}
          aria-label={busy ? 'Posting message' : 'Post message'}
        >
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m21 3-6.5 18-4-7.5L3 9.5 21 3Z" />
            <path d="m10.5 13.5 5-5" />
          </svg>
        </button>
      </form>
      {failure && !deleting && <p role="alert">{failure}</p>}
      {loading && !data && <p role="status">Loading activity…</p>}
      {error && (
        <div>
          <p role="alert">{error}</p>
          <button onClick={reload}>Retry</button>
        </div>
      )}
      {data?.items.length === 0 && <p>No activity yet.</p>}
      <ul className="comment-list event-log">
        {data?.items.map((entry) => (
          <li key={entry.key} className="comment-row">
            <PersonPhoto
              name={entry.displayName}
              src={guestPhoto(entry)}
              size={32}
            />
            <div>
              <p className="comment-text">
                <GuestName guest={entry} linkProfiles={linkProfiles} />
                {entryText(entry)}
                {entry.kind === 'message' && entry.body}
              </p>
              <div className="comment-meta">
                <RelativeTime timestamp={entry.createdAt} />
                {entry.canDelete && (
                  <button
                    type="button"
                    className="comment-delete"
                    aria-label="Delete message"
                    title="Delete message"
                    aria-haspopup="dialog"
                    disabled={busy}
                    onClick={() => setDeleting(entry)}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
      <nav className="actions" aria-label="Activity pages">
        {history.length > 1 && (
          <button
            disabled={loading}
            onClick={() => setHistory(history.slice(0, -1))}
          >
            Newer
          </button>
        )}
        {data?.next && (
          <button
            disabled={loading}
            onClick={() => setHistory([...history, data.next!])}
          >
            Older
          </button>
        )}
      </nav>
      {deleting && (
        <ConfirmDialog
          title="Delete message?"
          confirmLabel="Delete message"
          danger
          busy={busy}
          error={failure}
          onClose={() => {
            setDeleting(null);
            setFailure('');
          }}
          onConfirm={() => void remove()}
        >
          <p>This removes the message for everyone.</p>
        </ConfirmDialog>
      )}
    </>
  );
}
