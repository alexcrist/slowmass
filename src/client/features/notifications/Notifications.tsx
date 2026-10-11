import { useEffect, useState } from 'react';
import { api, jsonRequest } from '../../api';
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
    [page, setPage] = useState<Page | null>(null),
    [version, setVersion] = useState(0),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [postId, setPostId] = useState<string | null>(null);
  const cursor = history[history.length - 1];
  useEffect(() => {
    const controller = new AbortController();
    api<Page>(`/api/notifications?cursor=${encodeURIComponent(cursor)}`, {
      signal: controller.signal,
    })
      .then((data) => {
        setPage(data);
        setError('');
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [cursor, version]);
  async function act(handle: string, action: 'accept' | 'deny') {
    setBusy(true);
    setError('');
    try {
      await api(`/api/people/${encodeURIComponent(handle)}/${action}`, {
        method: 'POST',
      });
      setVersion((v) => v + 1);
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
      setVersion((v) => v + 1);
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
          disabled={busy}
          onClick={() => {
            setPage(null);
            setHistory(['']);
            setVersion((v) => v + 1);
          }}
        >
          Refresh notifications
        </button>
        {page?.items.some((item) => item.unread) && (
          <button disabled={busy} onClick={() => void read()}>
            Mark this page read
          </button>
        )}
      </div>
      {!page && !error && <p role="status">Loading notifications…</p>}
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
                    disabled={busy}
                    onClick={() => void act(item.handle!, 'accept')}
                  >
                    Accept
                  </button>
                  <button
                    disabled={busy}
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
      <nav className="actions" aria-label="Notification pages">
        {history.length > 1 && (
          <button
            disabled={busy}
            onClick={() => {
              setPage(null);
              setHistory(history.slice(0, -1));
            }}
          >
            Newer
          </button>
        )}
        {page?.next && (
          <button
            disabled={busy}
            onClick={() => {
              setPage(null);
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
