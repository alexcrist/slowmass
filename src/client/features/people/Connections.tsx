import { useState } from 'react';
import { api } from '../../api';
import { profileHref } from '../../navigation';
import { usePageHistory } from '../../navigation/PageHistory';
import { ScrollPagesEnd } from '../../navigation/ScrollPagesEnd';
import { useScrollPages } from '../../navigation/useScrollPages';
import { PersonLink } from '../../navigation/PersonLink';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
export type Kind = 'following' | 'followers' | 'blocked';
type Person = { handle: string; displayName: string };
const identify = (person: Person) => person.handle;
type ConnectionsProps =
  | { kind: Kind; handle?: undefined }
  | { kind: 'following' | 'followers'; handle: string };
export function Connections({ kind, handle }: ConnectionsProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState<string | null>(null);
  const path = handle
    ? `/api/people/${encodeURIComponent(handle)}/connections`
    : '/api/people/connections';
  const pages = useScrollPages({
    history: usePageHistory(`connections:${handle ?? 'self'}:${kind}`),
    path: (after) => `${path}?kind=${kind}&after=${encodeURIComponent(after)}`,
    identify,
  });
  const { items, loading, revalidating, update } = pages;
  async function act(handle: string, action: string) {
    if (busy || revalidating) return;
    setBusy(true);
    setError('');
    try {
      await api(`/api/people/${encodeURIComponent(handle)}/${action}`, {
        method: 'POST',
      });
      setConfirming(null);
      update((people) => people.filter((person) => person.handle !== handle));
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
      {loading && !items && <p role="status">Loading…</p>}
      {!loading && items?.length === 0 && <p>No accounts.</p>}
      <ul className="people-list connection-list">
        {items?.map((person) => (
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
                disabled={busy || revalidating}
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
      <ScrollPagesEnd
        pages={pages}
        loading="Loading more accounts…"
        more="Show more accounts"
      />
    </>
  );
}
