import { useState, useEffect } from 'react';
import { api } from '../../api';
import { profileHref } from '../../navigation';
export type Kind = 'requests' | 'following' | 'followers' | 'blocked';
export function Connections({ kind }: { kind: Kind }) {
  const [pages, setPages] = useState(['']);
  const [data, setData] = useState<{
    items: { handle: string; displayName: string }[];
    next: string | null;
  } | null>(null);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const after = pages[pages.length - 1];
  useEffect(() => {
    const controller = new AbortController();
    api<NonNullable<typeof data>>(
      `/api/people/connections?kind=${kind}&after=${encodeURIComponent(after)}`,
      { signal: controller.signal },
    )
      .then((result) => {
        setData(result);
        setError('');
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(error.message);
      });
    return () => controller.abort();
  }, [kind, after, version]);
  async function act(handle: string, action: string) {
    setBusy(true);
    setError('');
    try {
      await api(`/api/people/${encodeURIComponent(handle)}/${action}`, {
        method: 'POST',
      });
      setVersion(version + 1);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Action failed.');
    } finally {
      setBusy(false);
    }
  }
  const action =
    kind === 'requests'
      ? 'accept'
      : kind === 'following'
        ? 'unfollow'
        : kind === 'followers'
          ? 'remove'
          : 'unblock';
  return (
    <>
      {!data && !error && <p role="status">Loading…</p>}
      {data?.items.length === 0 && <p>No accounts on this page.</p>}
      <ul className="people-list">
        {data?.items.map((person) => (
          <li key={person.handle}>
            <span>
              <a href={profileHref(person.handle)}>@{person.handle}</a>
            </span>
            <div className="actions">
              <button
                disabled={busy}
                onClick={() => void act(person.handle, action)}
              >
                {kind === 'requests'
                  ? 'Accept'
                  : kind === 'following'
                    ? 'Unfollow'
                    : kind === 'followers'
                      ? 'Remove follower'
                      : 'Unblock'}
              </button>
              {kind === 'requests' && (
                <button
                  disabled={busy}
                  onClick={() => void act(person.handle, 'deny')}
                >
                  Deny
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {error && (
        <div>
          <p role="alert" className="error-message">
            {error}
          </p>
          <button onClick={() => setVersion(version + 1)}>Retry</button>
        </div>
      )}
      <nav className="actions" aria-label="List pages">
        {pages.length > 1 && (
          <button
            disabled={busy}
            onClick={() => {
              setData(null);
              setPages(pages.slice(0, -1));
            }}
          >
            Previous
          </button>
        )}
        {data?.next && (
          <button
            disabled={busy}
            onClick={() => {
              setData(null);
              setPages([...pages, data.next!]);
            }}
          >
            Next
          </button>
        )}
      </nav>
    </>
  );
}
