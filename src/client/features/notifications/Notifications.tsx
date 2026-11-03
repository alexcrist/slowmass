import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from '../../api';
import { eventHref, postHref, profileHref } from '../../navigation';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
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
type Page = { items: Item[]; next: string | null };
// Reload the first `depth` pages as one cursor chain, or append the page after
// a cursor. Reloading the chain keeps loaded pages contiguous after mutations.
type Load = { depth: number } | { after: string };
const pagePath = (cursor: string) =>
  `/api/notifications?cursor=${encodeURIComponent(cursor)}&includeJoined=1&includeEvents=1&includeHosting=1&includeComments=1`;
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
  // Remember how many pages were loaded, never the responses themselves.
  const [history, setHistory] = usePageHistory('notifications');
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [declining, setDeclining] = useState<HostInvite | null>(null),
    [sentinel, setSentinel] = useState<Element | null>(null);
  const [request, setRequest] = useState<Load>(() => ({
    depth: history.length,
  }));
  const [pages, setPages] = useState<Page[] | null>(null);
  const [result, setResult] = useState<{ request: Load; error: string } | null>(
    null,
  );
  const loading = result?.request !== request;
  const loadError = loading ? '' : (result?.error ?? '');
  useEffect(() => {
    const controller = new AbortController();
    let timedOut = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const read = async (cursor: string) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, 15_000);
      return api<Page>(pagePath(cursor), { signal: controller.signal });
    };
    void (async () => {
      try {
        let loaded: Page[] | null = null;
        let added: Page | null = null;
        if ('after' in request) added = await read(request.after);
        else {
          loaded = [];
          let cursor = '';
          while (loaded.length < request.depth) {
            const page = await read(cursor);
            loaded.push(page);
            if (!page.next) break;
            cursor = page.next;
          }
        }
        if (controller.signal.aborted) return;
        setPages(
          (current) =>
            loaded ?? (current && added ? [...current, added] : current),
        );
        setResult({ request, error: '' });
      } catch (e) {
        if (controller.signal.aborted && !timedOut) return;
        setResult({
          request,
          error: timedOut
            ? 'This page took too long to load. Please try again.'
            : e instanceof Error
              ? e.message
              : 'Could not load this page. Please try again.',
        });
      } finally {
        clearTimeout(timeout);
      }
    })();
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [request]);
  // A revalidation can pull the next page's first row onto an earlier page;
  // show each activity once.
  const items = useMemo(() => {
    const seen = new Set<string>();
    return pages
      ?.flatMap((page) => page.items)
      .filter((item) => !seen.has(item.key) && Boolean(seen.add(item.key)));
  }, [pages]);
  const depth = pages?.length ?? history.length;
  const newest = depth === 1;
  const after = loading || loadError ? null : pages?.at(-1)?.next;
  // Fetch the next page once the end of the list nears the viewport. A fresh
  // observer per loaded page reports immediately, so short lists keep filling.
  useEffect(() => {
    if (!after || !sentinel || typeof IntersectionObserver === 'undefined')
      return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        setRequest({ after });
      },
      { rootMargin: '0px 0px 600px 0px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [after, sentinel]);
  const [stale, setStale] = useState(false);
  const latest = useRef({ newest, count, pages, setHistory });
  useEffect(() => {
    latest.current.newest = newest;
    latest.current.setHistory = setHistory;
  });
  useEffect(() => {
    if (!pages || latest.current.pages === pages) return;
    latest.current.pages = pages;
    latest.current.setHistory([
      '',
      ...pages.slice(0, -1).map((page) => page.next ?? ''),
    ]);
  }, [pages]);
  // Keep the newest page current without a manual refresh: reread it in place
  // when the app returns to the foreground or the badge rises. Once older
  // pages are loaded, offer Latest instead of moving content under the reader.
  useEffect(() => {
    const previous = latest.current.count;
    latest.current.count = count;
    if (count == null || previous == null || count <= previous) return;
    if (latest.current.newest) setRequest({ depth: 1 });
    else setStale(true);
  }, [count]);
  useEffect(() => {
    const returned = () => {
      if (document.visibilityState === 'visible' && latest.current.newest)
        setRequest({ depth: 1 });
    };
    document.addEventListener('visibilitychange', returned);
    return () => document.removeEventListener('visibilitychange', returned);
  }, []);
  if (newest && stale) setStale(false);
  const { list, readError } = useReadActivity(items, onChange);
  // Apply a confirmed mutation, then revalidate every loaded page.
  function refresh(update: (items: Item[]) => Item[]) {
    setPages(
      (current) =>
        current?.map((page) => ({ ...page, items: update(page.items) })) ??
        null,
    );
    setRequest({ depth });
  }
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
              setRequest({ depth: 1 });
              window.scrollTo({ top: 0, behavior: 'instant' });
            }}
          >
            Latest
          </button>
        </div>
      )}
      {!pages && loading && <p role="status">Loading notifications…</p>}
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
      <div ref={setSentinel} aria-hidden="true" />
      {loading && 'after' in request && (
        <p role="status">Loading older activity…</p>
      )}
      {loadError && (
        <div>
          <p role="alert">{loadError}</p>
          <button onClick={() => setRequest({ ...request })}>Retry</button>
        </div>
      )}
      {after && typeof IntersectionObserver === 'undefined' && (
        <button disabled={busy} onClick={() => setRequest({ after })}>
          Show older activity
        </button>
      )}
    </>
  );
}
