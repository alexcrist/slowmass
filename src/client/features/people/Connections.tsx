import { useState } from 'react';
import { api } from '../../api';
import { useApiResource } from '../../api/useApiResource';
import { profileHref } from '../../navigation';
import { PersonLink } from '../../navigation/PersonLink';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
export type Kind = 'following' | 'followers' | 'blocked';
type ConnectionsProps =
  | { kind: Kind; handle?: undefined }
  | { kind: 'following' | 'followers'; handle: string };
export function Connections({ kind, handle }: ConnectionsProps) {
  const [pages, setPages] = useState(['']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState<string | null>(null);
  const after = pages[pages.length - 1];
  const path = handle
    ? `/api/people/${encodeURIComponent(handle)}/connections`
    : '/api/people/connections';
  const {
    data,
    error: loadError,
    loading,
    reload,
    refresh,
  } = useApiResource<{
    items: { handle: string; displayName: string }[];
    next: string | null;
  }>(`${path}?kind=${kind}&after=${encodeURIComponent(after)}`);
  async function act(handle: string, action: string) {
    if (busy || loading) return;
    setBusy(true);
    setError('');
    try {
      await api(`/api/people/${encodeURIComponent(handle)}/${action}`, {
        method: 'POST',
      });
      setConfirming(null);
      refresh((current) => ({
        ...current,
        items: current.items.filter((person) => person.handle !== handle),
      }));
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
      {loading && !data && <p role="status">Loading…</p>}
      {!loading && data?.items.length === 0 && <p>No accounts on this page.</p>}
      <ul className="people-list connection-list">
        {data?.items.map((person) => (
          <li className="connection-row" key={person.handle}>
            {kind === 'blocked' ? (
              <a href={profileHref(person.handle)}>{person.handle}</a>
            ) : (
              <PersonLink handle={person.handle} />
            )}
            {!handle && (
              <button
                type="button"
                className="compact-button"
                disabled={busy || loading}
                aria-label={
                  kind === 'followers'
                    ? `Remove ${person.handle} as a follower`
                    : `${kind === 'following' ? 'Unfollow' : 'Unblock'} ${person.handle}`
                }
                aria-haspopup={kind === 'blocked' ? undefined : 'dialog'}
                onClick={() => {
                  setError('');
                  if (kind === 'blocked') void act(person.handle, action);
                  else setConfirming(person.handle);
                }}
              >
                <span>
                  {kind === 'following'
                    ? 'Unfollow'
                    : kind === 'followers'
                      ? 'Remove'
                      : 'Unblock'}
                </span>
              </button>
            )}
          </li>
        ))}
      </ul>
      {confirming && (
        <ConfirmDialog
          title={kind === 'followers' ? 'Remove follower' : 'Unfollow'}
          confirmLabel={kind === 'followers' ? 'Remove follower' : 'Unfollow'}
          error={error}
          onConfirm={() => void act(confirming, action)}
          busy={busy}
          onClose={() => {
            setConfirming(null);
            setError('');
          }}
        >
          <p>
            {kind === 'followers'
              ? `${confirming} will need to request to follow you again to see your posts.`
              : `Stop following ${confirming}? You will need their approval to follow them again.`}
          </p>
        </ConfirmDialog>
      )}
      {error && !confirming && <p role="alert">{error}</p>}
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
