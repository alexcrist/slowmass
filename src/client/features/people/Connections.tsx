import { useState } from 'react';
import { api } from '../../api';
import { useApiResource } from '../../api/useApiResource';
import { profileHref } from '../../navigation';
export type Kind = 'following' | 'followers' | 'blocked';
export function Connections({ kind }: { kind: Kind }) {
  const [pages, setPages] = useState(['']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const after = pages[pages.length - 1];
  const {
    data,
    error: loadError,
    loading,
    reload,
  } = useApiResource<{
    items: { handle: string; displayName: string }[];
    next: string | null;
  }>(`/api/people/connections?kind=${kind}&after=${encodeURIComponent(after)}`);
  async function act(handle: string, action: string) {
    setBusy(true);
    setError('');
    try {
      await api(`/api/people/${encodeURIComponent(handle)}/${action}`, {
        method: 'POST',
      });
      reload();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Action failed.');
    } finally {
      setBusy(false);
    }
  }
  const action =
    kind === 'following'
      ? 'unfollow'
      : kind === 'followers'
        ? 'remove'
        : 'unblock';
  return (
    <>
      {loading && <p role="status">Loading…</p>}
      {data?.items.length === 0 && <p>No accounts on this page.</p>}
      <ul className="people-list">
        {data?.items.map((person) => (
          <li key={person.handle}>
            <span>
              <a href={profileHref(person.handle)}>@{person.handle}</a>
            </span>
            <div className="actions">
              <button
                disabled={busy || loading}
                onClick={() => void act(person.handle, action)}
              >
                {kind === 'following'
                  ? 'Unfollow'
                  : kind === 'followers'
                    ? 'Remove follower'
                    : 'Unblock'}
              </button>
            </div>
          </li>
        ))}
      </ul>
      {error && <p role="alert">{error}</p>}
      {loadError && (
        <div>
          <p role="alert" className="error-message">
            {loadError}
          </p>
          <button onClick={reload}>Retry</button>
        </div>
      )}
      <nav className="actions" aria-label="List pages">
        {pages.length > 1 && (
          <button
            disabled={busy || loading}
            onClick={() => {
              setPages(pages.slice(0, -1));
            }}
          >
            Previous
          </button>
        )}
        {data?.next && (
          <button
            disabled={busy || loading}
            onClick={() => {
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
