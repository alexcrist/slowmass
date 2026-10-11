import { useState } from 'react';
import { api, jsonRequest } from '../../api';
import { useApiResource } from '../../api/useApiResource';
import { PostDetail } from '../posts/Posts';
type Item = {
  key: string;
  kind: 'request' | 'likes' | 'comment';
  postId: string | null;
  handle: string | null;
  body: string | null;
  count: number;
  createdAt: number;
  unread: number;
};
type Page = { items: Item[]; next: string | null };
export function Notifications() {
  const [history, setHistory] = useState(['']),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [postId, setPostId] = useState<string | null>(null);
  const cursor = history[history.length - 1];
  const {
    data: page,
    error: loadError,
    loading,
    reload,
  } = useApiResource<Page>(
    `/api/notifications?cursor=${encodeURIComponent(cursor)}`,
  );
  async function act(handle: string, action: 'accept' | 'deny') {
    setBusy(true);
    setError('');
    try {
      await api(`/api/people/${encodeURIComponent(handle)}/${action}`, {
        method: 'POST',
      });
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update request.');
    } finally {
      setBusy(false);
    }
  }
  async function read() {
    if (!page) return;
    setBusy(true);
    setError('');
    try {
      await api(
        '/api/notifications/read',
        jsonRequest('POST', {
          items: page.items.map(({ key, createdAt }) => ({ key, createdAt })),
        }),
      );
      reload();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Could not mark notifications read.',
      );
    } finally {
      setBusy(false);
    }
  }
  if (postId)
    return (
      <>
        <button onClick={() => setPostId(null)}>Back to notifications</button>
        <PostDetail key={postId} id={postId} />
      </>
    );
  return (
    <>
      <div className="actions">
        <button
          disabled={busy || loading}
          onClick={() => {
            setError('');
            setHistory(['']);
            reload();
          }}
        >
          Refresh notifications
        </button>
        {page?.items.some((item) => item.unread) && (
          <button disabled={busy || loading} onClick={() => void read()}>
            Mark this page read
          </button>
        )}
      </div>
      {loading && <p role="status">Loading notifications…</p>}
      {page?.items.length === 0 && <p>No notifications on this page.</p>}
      <ul className="notification-list">
        {page?.items.map((item) => (
          <li key={item.key}>
            {Boolean(item.unread) && <strong>Unread. </strong>}
            {item.kind === 'request' ? (
              <>
                <p>@{item.handle} requested to follow you.</p>
                <div className="actions">
                  <button
                    disabled={busy || loading}
                    onClick={() => void act(item.handle!, 'accept')}
                  >
                    Accept
                  </button>
                  <button
                    disabled={busy || loading}
                    onClick={() => void act(item.handle!, 'deny')}
                  >
                    Deny
                  </button>
                </div>
              </>
            ) : item.kind === 'likes' ? (
              <p>
                {item.count} {item.count === 1 ? 'person likes' : 'people like'}{' '}
                your photo.
              </p>
            ) : (
              <>
                <p>@{item.handle} commented on your photo.</p>
                <p className="bio">{item.body}</p>
              </>
            )}
            <time dateTime={new Date(item.createdAt).toISOString()}>
              {new Date(item.createdAt).toLocaleString()}
            </time>
            {item.postId && (
              <button
                className="text-button"
                onClick={() => setPostId(item.postId)}
              >
                View photo
              </button>
            )}
          </li>
        ))}
      </ul>
      {error && <p role="alert">{error}</p>}
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
