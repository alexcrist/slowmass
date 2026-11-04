import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { api, jsonRequest } from '../../api';
import { usePageHistory } from '../../navigation/PageHistory';
import { ScrollPagesEnd } from '../../navigation/ScrollPagesEnd';
import { useScrollPages } from '../../navigation/useScrollPages';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { Composer } from '../../ui/Composer';
import { RelativeTime } from '../../ui/RelativeTime';
import { PersonPhoto } from './EventSummary';
import { GuestName, guestPhoto } from './EventGuests';
import { answerEmoji, type Answer } from './types';
import { useSeenActivity } from '../notifications';

type Entry = {
  key: string;
  kind: 'response' | 'message' | 'cancelled';
  id: string | null;
  status: Answer | null;
  body: string;
  createdAt: number;
  handle: string;
  displayName: string;
  hasAvatar: boolean;
  canDelete: boolean;
};

const identify = (entry: Entry) => entry.key;

function entryText(entry: Entry) {
  if (entry.kind === 'response')
    return entry.status === 'going'
      ? ' is going '
      : entry.status === 'maybe'
        ? ' might go '
        : ' can’t go ';
  if (entry.kind === 'cancelled') return ' cancelled the event.';
  return ' ';
}

// Seeing a message (or a cancellation) reads its notification.
function EntryText({ entry, children }: { entry: Entry; children: ReactNode }) {
  const seen = useSeenActivity<HTMLParagraphElement>(
    entry.kind !== 'response' && entry.id
      ? { keys: [`event_message:${entry.id}`] }
      : null,
  );
  return (
    <p className="comment-text" ref={seen}>
      {children}
    </p>
  );
}

// Answers and messages, newest first, with a composer below for hosts and
// guests. Older entries load through Show more so the composer stays
// reachable.
export function EventLog({
  id,
  linkProfiles,
  onPosted,
  refreshVersion = 0,
}: {
  id: string;
  linkProfiles: boolean;
  onPosted?: () => void;
  refreshVersion?: number;
}) {
  const pages = useScrollPages({
    history: usePageHistory(`event/${id}/activity`),
    path: (cursor) =>
      `/api/events/${id}/activity${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
    identify,
    automatic: false,
  });
  const { items, loading, revalidate, update } = pages;
  const [body, setBody] = useState('');
  const [messageId, setMessageId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const [deleting, setDeleting] = useState<Entry | null>(null);
  const lastRefresh = useRef({ version: refreshVersion, revalidate });
  useEffect(() => {
    lastRefresh.current.revalidate = revalidate;
  });
  // A changed answer or cancellation on the event page rereads loaded entries.
  useEffect(() => {
    if (lastRefresh.current.version === refreshVersion) return;
    lastRefresh.current.version = refreshVersion;
    lastRefresh.current.revalidate();
  }, [refreshVersion]);
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
      revalidate();
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
      update((entries) =>
        entries.filter((entry) => entry.key !== deleting.key),
      );
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
      {loading && !items && <p role="status">Loading activity…</p>}
      {!loading && items?.length === 0 && <p>No activity yet.</p>}
      <ul className="comment-list event-log">
        {items?.map((entry) => (
          <li key={entry.key} className="comment-row">
            <PersonPhoto
              name={entry.displayName}
              profileHandle={entry.hasAvatar ? entry.handle : undefined}
              src={guestPhoto(entry)}
              size={32}
            />
            <div>
              <EntryText entry={entry}>
                <GuestName guest={entry} linkProfiles={linkProfiles} />
                {entryText(entry)}
                {entry.status && (
                  <span aria-hidden="true">{answerEmoji[entry.status]}</span>
                )}
                {entry.kind === 'message' && entry.body}
              </EntryText>
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
      <ScrollPagesEnd
        pages={pages}
        loading="Loading more activity…"
        more="Show more activity"
      />
      <Composer
        label="Write a message"
        placeholder="Write a message…"
        maxLength={2000}
        value={body}
        busy={busy}
        canSubmit
        submitLabel="Post message"
        pendingLabel="Posting message"
        onChange={(value) => {
          setBody(value);
          setMessageId(crypto.randomUUID());
        }}
        onSubmit={(submit) => void post(submit)}
      />
      {failure && !deleting && <p role="alert">{failure}</p>}
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
