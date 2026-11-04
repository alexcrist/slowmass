import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '../../api';
import { eventHref, postHref, profileHref } from '../../navigation';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { usePageHistory } from '../../navigation/PageHistory';
import { ScrollPagesEnd } from '../../navigation/ScrollPagesEnd';
import { useScrollPages } from '../../navigation/useScrollPages';
import { useReadActivity } from './useReadActivity';
type Item = {
  key: string;
  version: number;
  unread: boolean;
  createdAt: number;
} & (
  | { kind: 'request'; handle: string }
  | { kind: 'follower'; handle: string; canFollowBack: boolean }
  | { kind: 'joined'; handle: string }
  | { kind: 'likes'; postId: string; count: number; more: boolean }
  | {
      kind: 'comment' | 'thread_comment' | 'comment_like';
      postId: string;
      handle: string;
      body: string;
    }
  | {
      kind: 'event_response';
      eventId: string;
      eventTitle: string;
      displayName: string;
      response: 'going' | 'maybe' | 'declined';
    }
  | {
      kind: 'event_message';
      eventId: string;
      eventTitle: string;
      displayName: string;
      messageKind: 'message' | 'cancelled';
      body: string;
    }
  | {
      kind: 'host_invite';
      eventId: string;
      eventTitle: string;
      displayName: string;
      hosting: boolean;
    }
  | {
      kind: 'host_accepted';
      eventId: string;
      eventTitle: string;
      displayName: string;
    }
);
type HostInvite = Extract<Item, { kind: 'host_invite' }>;
// Guests never choose a username, so event activity uses names.
function eventText(item: Item) {
  if (item.kind === 'event_response')
    return `${item.displayName} ${
      item.response === 'going'
        ? 'is going to'
        : item.response === 'maybe'
          ? 'might go to'
          : 'can’t go to'
    } ${item.eventTitle}.`;
  if (item.kind === 'host_invite')
    return item.hosting
      ? `You’re co-hosting ${item.eventTitle} with ${item.displayName}.`
      : `${item.displayName} asked you to co-host ${item.eventTitle}.`;
  if (item.kind === 'host_accepted')
    return `${item.displayName} is now co-hosting ${item.eventTitle}.`;
  if (item.kind !== 'event_message') return '';
  return item.messageKind === 'cancelled'
    ? `${item.displayName} cancelled ${item.eventTitle}.`
    : `${item.displayName} posted in ${item.eventTitle}.`;
}
const pagePath = (cursor: string) =>
  `/api/notifications?cursor=${encodeURIComponent(cursor)}&includeJoined=1&includeEvents=1&includeHosting=1&includeComments=1`;
const identify = (item: Item) => item.key;
export function Notifications({
  onChange,
  count,
  leading,
}: {
  onChange?: () => void;
  // The shell's unread badge; a rise means newer activity exists.
  count?: number | null;
  // A row rendered above the newest page, outside server pagination/read state.
  leading?: ReactNode;
}) {
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [declining, setDeclining] = useState<HostInvite | null>(null);
  const pages = useScrollPages({
    history: usePageHistory('notifications'),
    path: pagePath,
    identify,
  });
  const { items, depth, loading, reload, update: refresh } = pages;
  const newest = depth === 1;
  const [stale, setStale] = useState(false);
  const latest = useRef({ newest, count, reload });
  useEffect(() => {
    latest.current.newest = newest;
    latest.current.reload = reload;
  });
  // Keep the newest page current without a manual refresh: reread it in place
  // when the app returns to the foreground or the badge rises. Once older
  // pages are loaded, offer Latest instead of moving content under the reader.
  useEffect(() => {
    const previous = latest.current.count;
    latest.current.count = count;
    if (count == null || previous == null || count <= previous) return;
    if (latest.current.newest) latest.current.reload(1);
    else setStale(true);
  }, [count]);
  useEffect(() => {
    const returned = () => {
      if (document.visibilityState === 'visible' && latest.current.newest)
        latest.current.reload(1);
    };
    document.addEventListener('visibilitychange', returned);
    return () => document.removeEventListener('visibilitychange', returned);
  }, []);
  if (newest && stale) setStale(false);
  const { list, readError } = useReadActivity(items, onChange);
  async function act(handle: string, action: 'accept' | 'deny' | 'request') {
    if (busy || loading) return;
    setBusy(true);
    setError('');
    try {
      await api(`/api/people/${encodeURIComponent(handle)}/${action}`, {
        method: 'POST',
      });
      refresh((items) =>
        action === 'request'
          ? items.map((item) =>
              item.kind === 'follower' && item.handle === handle
                ? { ...item, canFollowBack: false }
                : item,
            )
          : items.filter(
              (item) => item.kind !== 'request' || item.handle !== handle,
            ),
      );
      onChange?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update request.');
    } finally {
      setBusy(false);
    }
  }
  // Declining is confirmed first, as on the event page, since only a host can
  // invite again. Either answer is the event feature's own hosting mutation.
  async function answerHosting(item: HostInvite, accept: boolean) {
    if (busy || loading) return;
    setBusy(true);
    setError('');
    try {
      await api(`/api/events/${encodeURIComponent(item.eventId)}/hosting`, {
        method: accept ? 'POST' : 'DELETE',
      });
      setDeclining(null);
      refresh((items) =>
        accept
          ? items.map((entry) =>
              entry.key === item.key ? { ...item, hosting: true } : entry,
            )
          : items.filter((entry) => entry.key !== item.key),
      );
      onChange?.();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Could not answer the invitation.',
      );
    } finally {
      setBusy(false);
    }
  }
  async function dismissFollowBack(item: Item) {
    if (busy || loading) return;
    setBusy(true);
    setError('');
    try {
      await api('/api/notifications/dismiss-follow-back', {
        method: 'POST',
        body: JSON.stringify({ key: item.key, version: item.version }),
      });
      refresh((items) =>
        items.map((entry) =>
          entry.kind === 'follower' && entry.key === item.key
            ? { ...entry, canFollowBack: false }
            : entry,
        ),
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Could not dismiss follow back.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {stale && !newest && (
        <div className="actions">
          <p role="status">There’s new activity.</p>
          <button
            disabled={busy}
            onClick={() => {
              setError('');
              setStale(false);
              reload(1);
              window.scrollTo({ top: 0, behavior: 'instant' });
            }}
          >
            Latest
          </button>
        </div>
      )}
      {!items && loading && <p role="status">Loading notifications…</p>}
      {!loading && items?.length === 0 && <p>No activity yet.</p>}
      <ul className="notification-list" ref={list}>
        {leading}
        {items?.map((item) => (
          <li key={item.key}>
            {item.kind === 'host_invite' ? (
              <div className="notification-request">
                <a
                  className="notification-person"
                  href={eventHref(item.eventId)}
                >
                  <img
                    className="notification-thumbnail"
                    src={`/media/events/${encodeURIComponent(item.eventId)}?size=thumb`}
                    width={64}
                    height={64}
                    alt=""
                    loading="lazy"
                    decoding="async"
                  />
                  <div className="notification-content">
                    <p data-notification-key={item.key}>{eventText(item)}</p>
                    <time dateTime={new Date(item.createdAt).toISOString()}>
                      {new Date(item.createdAt).toLocaleString()}
                    </time>
                  </div>
                </a>
                {!item.hosting && (
                  <div className="notification-actions">
                    <button
                      className="primary-button"
                      disabled={busy || loading}
                      onClick={() => void answerHosting(item, true)}
                    >
                      Accept
                    </button>
                    <button
                      disabled={busy || loading}
                      onClick={() => {
                        setError('');
                        setDeclining(item);
                      }}
                    >
                      Decline
                    </button>
                  </div>
                )}
              </div>
            ) : item.kind === 'event_response' ||
              item.kind === 'event_message' ||
              item.kind === 'host_accepted' ? (
              <a className="notification-post" href={eventHref(item.eventId)}>
                <img
                  className="notification-thumbnail"
                  src={`/media/events/${encodeURIComponent(item.eventId)}?size=thumb`}
                  width={64}
                  height={64}
                  alt=""
                  loading="lazy"
                  decoding="async"
                />
                <div className="notification-content">
                  <p data-notification-key={item.key}>{eventText(item)}</p>
                  {item.kind === 'event_message' &&
                    item.messageKind === 'message' && (
                      <p className="bio">{item.body}</p>
                    )}
                  <time dateTime={new Date(item.createdAt).toISOString()}>
                    {new Date(item.createdAt).toLocaleString()}
                  </time>
                </div>
              </a>
            ) : item.kind === 'joined' ? (
              <a
                className="notification-post notification-joined"
                href={profileHref(item.handle)}
              >
                <img
                  className="notification-thumbnail"
                  src={`/media/avatar/${encodeURIComponent(item.handle)}`}
                  width={64}
                  height={64}
                  alt=""
                  loading="lazy"
                  decoding="async"
                />
                <div className="notification-content">
                  <p data-notification-key={item.key}>
                    {item.handle} joined slowmass through your invitation.
                  </p>
                  <time dateTime={new Date(item.createdAt).toISOString()}>
                    {new Date(item.createdAt).toLocaleString()}
                  </time>
                </div>
              </a>
            ) : item.kind === 'request' || item.kind === 'follower' ? (
              <div className="notification-request">
                <a
                  className="notification-person"
                  href={profileHref(item.handle)}
                >
                  <img
                    className="notification-avatar"
                    src={`/media/avatar/${encodeURIComponent(item.handle)}`}
                    width={64}
                    height={64}
                    alt=""
                    loading="lazy"
                    decoding="async"
                  />
                  <div className="notification-content">
                    <p data-notification-key={item.key}>
                      {item.handle}{' '}
                      {item.kind === 'request'
                        ? 'requested to follow you.'
                        : 'started following you.'}
                    </p>
                    <time dateTime={new Date(item.createdAt).toISOString()}>
                      {new Date(item.createdAt).toLocaleString()}
                    </time>
                  </div>
                </a>
                {item.kind === 'request' ? (
                  <div className="notification-actions">
                    <button
                      className="primary-button"
                      disabled={busy || loading}
                      onClick={() => void act(item.handle, 'accept')}
                    >
                      Accept
                    </button>
                    <button
                      disabled={busy || loading}
                      onClick={() => void act(item.handle, 'deny')}
                    >
                      Deny
                    </button>
                  </div>
                ) : item.canFollowBack ? (
                  <div className="notification-actions">
                    <button
                      className="primary-button"
                      disabled={busy || loading}
                      onClick={() => void act(item.handle, 'request')}
                    >
                      Follow back
                    </button>
                    <button
                      className="notification-dismiss"
                      aria-label={`Dismiss follow back for ${item.handle}`}
                      disabled={busy || loading}
                      onClick={() => void dismissFollowBack(item)}
                    >
                      <span aria-hidden="true">×</span>
                    </button>
                  </div>
                ) : null}
              </div>
            ) : (
              <a className="notification-post" href={postHref(item.postId)}>
                <img
                  className="notification-thumbnail"
                  src={`/media/posts/${encodeURIComponent(item.postId)}?size=grid`}
                  alt=""
                  width={64}
                  height={64}
                  loading="lazy"
                  decoding="async"
                />
                <div className="notification-content">
                  {item.kind === 'likes' ? (
                    <p data-notification-key={item.key}>
                      {item.count} {item.more && 'more '}
                      {item.count === 1 ? 'person likes' : 'people like'} your
                      photo.
                    </p>
                  ) : (
                    <>
                      <p data-notification-key={item.key}>
                        {item.handle}{' '}
                        {item.kind === 'comment_like'
                          ? 'likes your comment.'
                          : item.kind === 'thread_comment'
                            ? 'also commented on a photo you commented on.'
                            : 'commented on your photo.'}
                      </p>
                      <p className="bio">{item.body}</p>
                    </>
                  )}
                  <time dateTime={new Date(item.createdAt).toISOString()}>
                    {new Date(item.createdAt).toLocaleString()}
                  </time>
                </div>
              </a>
            )}
          </li>
        ))}
      </ul>
      {error && !declining && <p role="alert">{error}</p>}
      {declining && (
        <ConfirmDialog
          title="Decline co-host invitation?"
          confirmLabel="Decline"
          danger
          busy={busy}
          error={error}
          onClose={() => {
            setDeclining(null);
            setError('');
          }}
          onConfirm={() => void answerHosting(declining, false)}
        >
          <p>
            You’ll still be able to see the event. {declining.displayName} would
            need to invite you again for you to co-host.
          </p>
        </ConfirmDialog>
      )}
      {readError && <p role="status">{readError}</p>}
      <ScrollPagesEnd
        pages={pages}
        loading="Loading older activity…"
        more="Show older activity"
        disabled={busy}
      />
    </>
  );
}
