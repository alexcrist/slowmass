import { useState } from 'react';
import { api } from '../../api';
import { useApiResource } from '../../api/useApiResource';
import { postHref, profileHref } from '../../navigation';
import { usePageHistory } from '../../navigation/PageHistory';
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
  | { kind: 'likes'; postId: string; count: number }
  | { kind: 'comment'; postId: string; handle: string; body: string }
);
type Page = { items: Item[]; next: string | null; focusFound?: boolean };
export function Notifications({
  onChange,
  focus,
}: {
  onChange?: () => void;
  focus?: string;
}) {
  const [history, setHistory] = usePageHistory(
    focus ? `notifications/${focus}` : 'notifications',
  );
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const cursor = history[history.length - 1];
  const {
    data: page,
    error: loadError,
    loading,
    reload,
    refresh,
  } = useApiResource<Page>(
    `/api/notifications?cursor=${encodeURIComponent(cursor)}${focus ? `&focus=${encodeURIComponent(focus)}` : ''}&includeJoined=1`,
  );
  const { list, readError } = useReadActivity(page?.items, onChange);
  async function act(handle: string, action: 'accept' | 'deny' | 'request') {
    if (busy || loading) return;
    setBusy(true);
    setError('');
    try {
      await api(`/api/people/${encodeURIComponent(handle)}/${action}`, {
        method: 'POST',
      });
      refresh((current) => ({
        ...current,
        items:
          action === 'request'
            ? current.items.map((item) =>
                item.kind === 'follower' && item.handle === handle
                  ? { ...item, canFollowBack: false }
                  : item,
              )
            : current.items.filter(
                (item) => item.kind !== 'request' || item.handle !== handle,
              ),
      }));
      onChange?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update request.');
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
      refresh((current) => ({
        ...current,
        items: current.items.map((entry) =>
          entry.kind === 'follower' && entry.key === item.key
            ? { ...entry, canFollowBack: false }
            : entry,
        ),
      }));
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
      {loading && !page && <p role="status">Loading notifications…</p>}
      {page?.focusFound === false && (
        <p role="status">That activity is no longer available.</p>
      )}
      {!loading && page?.items.length === 0 && <p>No activity on this page.</p>}
      <ul className="notification-list" ref={list}>
        {page?.items.map((item) => (
          <li key={item.key}>
            {item.kind === 'joined' ? (
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
                    @{item.handle} joined slowmass through your invitation.
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
                      @{item.handle}{' '}
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
                      aria-label={`Dismiss follow back for @${item.handle}`}
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
                      {item.count}{' '}
                      {item.count === 1 ? 'person likes' : 'people like'} your
                      photo.
                    </p>
                  ) : (
                    <>
                      <p data-notification-key={item.key}>
                        @{item.handle} commented on your photo.
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
      {error && <p role="alert">{error}</p>}
      {readError && <p role="status">{readError}</p>}
      {loadError && (
        <div>
          <p role="alert">{loadError}</p>
          <button onClick={reload}>Retry</button>
        </div>
      )}
      <nav className="actions" aria-label="Notification pages">
        {history.length > 1 && (
          <button
            disabled={busy || loading}
            onClick={() => {
              setError('');
              setHistory(history.slice(0, -1));
            }}
          >
            Newer
          </button>
        )}
        {page?.next && (
          <button
            disabled={busy || loading}
            onClick={() => {
              setError('');
              setHistory([...history, page.next!]);
            }}
          >
            Older
          </button>
        )}
      </nav>
    </>
  );
}
