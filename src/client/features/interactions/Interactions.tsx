import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { revealCommentComposer } from './comment-scroll';
import { useCommentHistory } from './CommentHistory';
import { PersonLink } from '../../navigation/PersonLink';
import { ScrollPagesEnd } from '../../navigation/ScrollPagesEnd';
import { useScrollPages } from '../../navigation/useScrollPages';
import { profileHref } from '../../navigation';
import { useSeenActivity } from '../notifications';
import { api, jsonRequest } from '../../api';
import { useApiResource } from '../../api/useApiResource';
import { Dialog } from '../../ui/Dialog';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { Composer } from '../../ui/Composer';
import { RelativeTime } from '../../ui/RelativeTime';
type Counts = { likeCount: number; commentCount: number; liked: number };
type Comment = {
  id: string;
  body: string;
  createdAt: number;
  handle: string;
  displayName: string;
  canDelete: number;
  likeCount: number;
  liked: number;
};
const identify = (comment: Comment) => comment.id;
export function Interactions({
  postId,
  initial,
  commentsInitiallyOpen = false,
  caption,
}: {
  postId: string;
  initial: Counts;
  commentsInitiallyOpen?: boolean;
  // Shown between the action row and the comments.
  caption?: ReactNode;
}) {
  const [counts, setCounts] = useState(initial),
    [likesOpen, setLikesOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [thread, rememberThread] = useCommentHistory(
    postId,
    commentsInitiallyOpen,
  );
  const open = thread.open;
  const commentButton = useRef<HTMLButtonElement>(null);
  // The post page's like count reads like notifications for this photo.
  const seenLikes = useSeenActivity<HTMLDivElement>(
    commentsInitiallyOpen
      ? { keys: [`likes:${postId}`], prefixes: [`likes:${postId}-`] }
      : null,
  );
  const [revealOnOpen, setRevealOnOpen] = useState(false);
  const [source, setSource] = useState(initial);
  if (source !== initial) {
    setSource(initial);
    setCounts(initial);
  }
  async function refresh() {
    const data = await api<{ post: Counts }>(`/api/posts/${postId}`);
    setCounts(data.post);
  }
  async function like() {
    setBusy(true);
    setError('');
    try {
      const updated = await api<Counts>(`/api/interactions/${postId}/like`, {
        method: counts.liked ? 'DELETE' : 'PUT',
      });
      setCounts(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update like.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="Likes and comments">
      <div className="post-interactions">
        <div className="reaction-pair" ref={seenLikes}>
          <button
            className="icon-button"
            disabled={busy}
            aria-label={counts.liked ? 'Unlike photo' : 'Like photo'}
            aria-pressed={Boolean(counts.liked)}
            onClick={() => void like()}
          >
            <HeartIcon liked={counts.liked} />
          </button>
          {counts.likeCount > 0 && (
            <button
              className="count-button"
              aria-label={`See ${counts.likeCount} likes`}
              aria-expanded={likesOpen}
              aria-haspopup="dialog"
              onClick={() => setLikesOpen(!likesOpen)}
            >
              {counts.likeCount}
            </button>
          )}
        </div>
        <button
          ref={commentButton}
          className="icon-button comment-toggle"
          aria-label={open ? 'Hide comments' : 'Show comments'}
          aria-expanded={open}
          onClick={() => {
            setRevealOnOpen(!open);
            rememberThread({ open: !open, pages: [''] });
          }}
        >
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          >
            <path d="M21 11a9 9 0 0 1-9 9H4l-2 2V11a9 9 0 0 1 19 0Z" />
          </svg>
          {counts.commentCount > 0 && <span>{counts.commentCount}</span>}
        </button>
      </div>
      {caption}
      {likesOpen && (
        <Likes
          path={`/api/interactions/${postId}/likes`}
          onClose={() => setLikesOpen(false)}
        />
      )}
      {error && <p role="alert">{error}</p>}
      {open && (
        <Comments
          postId={postId}
          onChange={refresh}
          commentButton={commentButton}
          revealOnOpen={revealOnOpen}
          history={thread.pages}
          setHistory={(pages) => rememberThread({ ...thread, pages })}
        />
      )}
    </section>
  );
}
function Comments({
  postId,
  onChange,
  commentButton,
  revealOnOpen,
  history,
  setHistory,
}: {
  postId: string;
  onChange: () => Promise<void>;
  commentButton: RefObject<HTMLButtonElement | null>;
  revealOnOpen: boolean;
  history: string[];
  setHistory: (pages: string[]) => void;
}) {
  const [body, setBody] = useState(''),
    [id, setId] = useState(() => crypto.randomUUID()),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [confirming, setConfirming] = useState<Comment | null>(null);
  // Older comments load through Show more so the composer below stays
  // reachable.
  const pages = useScrollPages({
    history: [history, setHistory],
    path: (after) =>
      `/api/interactions/${postId}/comments?after=${encodeURIComponent(after)}`,
    identify,
    automatic: false,
  });
  const { items, loading, revalidating, revalidate, update } = pages;
  const comments = useRef<HTMLDivElement>(null);
  const pendingReveal = useRef(revealOnOpen);
  useLayoutEffect(() => {
    // Measure the loaded thread once per button opening, never on Show more,
    // editing, or count refreshes. Initially expanded detail pages stay put.
    if (loading || !pendingReveal.current) return;
    pendingReveal.current = false;
    const composer = comments.current?.querySelector('.composer');
    if (composer && commentButton.current)
      return revealCommentComposer(commentButton.current, composer);
  }, [loading, commentButton]);
  // An empty thread needs no message: the composer takes the first comment's
  // place.
  const empty = !loading && items?.length === 0;
  async function add(event: FormEvent) {
    event.preventDefault();
    if (busy || revalidating || !body.trim()) return;
    setBusy(true);
    setError('');
    try {
      await api(
        `/api/interactions/${postId}/comments`,
        jsonRequest('POST', { id, body }),
      );
      setBody('');
      setId(crypto.randomUUID());
      revalidate();
      try {
        await onChange();
      } catch {
        setError('Comment posted. Reload to update the comment count.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add comment.');
    } finally {
      setBusy(false);
    }
  }
  async function remove(id: string) {
    if (busy || revalidating) return;
    setBusy(true);
    setError('');
    try {
      await api(`/api/interactions/comments/${id}`, { method: 'DELETE' });
      setConfirming(null);
      update((comments) => comments.filter((comment) => comment.id !== id));
      try {
        await onChange();
      } catch {
        setError('Comment deleted. Reload to update the comment count.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete comment.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="comments" ref={comments}>
      {loading && !items && <p role="status">Loading comments…</p>}
      <ul className="comment-list">
        {items?.map((comment) => (
          <CommentRow
            key={comment.id}
            comment={comment}
            busy={busy || revalidating}
            onDelete={() => {
              setError('');
              setConfirming(comment);
            }}
          />
        ))}
      </ul>
      {confirming && (
        <ConfirmDialog
          title="Delete comment"
          confirmLabel="Delete comment"
          danger
          busy={busy}
          error={error}
          onClose={() => {
            setConfirming(null);
            setError('');
          }}
          onConfirm={() => void remove(confirming.id)}
        >
          <p>
            Delete this comment by {confirming.handle}? This cannot be undone.
          </p>
        </ConfirmDialog>
      )}
      <ScrollPagesEnd
        pages={pages}
        loading="Loading more comments…"
        more="Show more comments"
        disabled={busy}
      />
      <Composer
        label="Add a comment"
        placeholder={empty ? 'Add the first comment…' : 'Add a comment…'}
        maxLength={1000}
        value={body}
        busy={busy}
        canSubmit={!revalidating}
        submitLabel="Post comment"
        pendingLabel="Posting comment"
        onChange={(value) => {
          setBody(value);
          setId(crypto.randomUUID());
        }}
        onSubmit={(e) => void add(e)}
      />
      {error && !confirming && <p role="alert">{error}</p>}
    </div>
  );
}
function HeartIcon({ liked }: { liked: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill={liked ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path d="M20 5c-3-3-6-1-8 1-2-2-5-4-8-1-4 4 1 9 8 15 7-6 12-11 8-15Z" />
    </svg>
  );
}
function CommentRow({
  comment,
  busy,
  onDelete,
}: {
  comment: Comment;
  busy: boolean;
  onDelete: () => void;
}) {
  const [counts, setCounts] = useState({
    likeCount: comment.likeCount,
    liked: comment.liked,
  });
  const [liking, setLiking] = useState(false);
  const [likesOpen, setLikesOpen] = useState(false);
  const [error, setError] = useState('');
  // Seeing a comment reads its notifications: the comment itself, the
  // follow-up in a thread, and likes on it.
  const seen = useSeenActivity<HTMLParagraphElement>({
    keys: [`comment:${comment.id}`, `thread_comment:${comment.id}`],
    prefixes: [`comment_like:${comment.id}.`],
  });
  const [source, setSource] = useState(comment);
  if (source !== comment) {
    setSource(comment);
    setCounts({ likeCount: comment.likeCount, liked: comment.liked });
  }
  async function toggleLike() {
    if (liking) return;
    setLiking(true);
    setError('');
    try {
      setCounts(
        await api<{ likeCount: number; liked: number }>(
          `/api/interactions/comments/${comment.id}/like`,
          { method: counts.liked ? 'DELETE' : 'PUT' },
        ),
      );
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'Could not update like.',
      );
    } finally {
      setLiking(false);
    }
  }
  return (
    <li className="comment-row">
      <a
        className="comment-avatar"
        href={profileHref(comment.handle)}
        aria-label={`View ${comment.handle}'s profile`}
      >
        <img
          src={`/media/avatar/${encodeURIComponent(comment.handle)}`}
          width={32}
          height={32}
          alt=""
          loading="lazy"
        />
      </a>
      <div className="comment-content">
        <p className="comment-text" ref={seen}>
          <a href={profileHref(comment.handle)}>
            <strong>{comment.handle}</strong>
          </a>{' '}
          {comment.body}
        </p>
        <div className="comment-meta">
          <RelativeTime timestamp={comment.createdAt} />
          {counts.likeCount > 0 && (
            <button
              type="button"
              className="comment-likes"
              aria-haspopup="dialog"
              aria-label={`See ${counts.likeCount} comment likes`}
              onClick={() => setLikesOpen(true)}
            >
              {counts.likeCount} {counts.likeCount === 1 ? 'like' : 'likes'}
            </button>
          )}
          {Boolean(comment.canDelete) && (
            <button
              type="button"
              className="comment-delete"
              aria-label="Delete comment"
              title="Delete comment"
              aria-haspopup="dialog"
              disabled={busy || liking}
              onClick={onDelete}
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
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
      </div>
      <button
        type="button"
        className="icon-button comment-heart"
        aria-label={counts.liked ? 'Unlike comment' : 'Like comment'}
        aria-pressed={Boolean(counts.liked)}
        disabled={busy || liking}
        onClick={() => void toggleLike()}
      >
        <HeartIcon liked={counts.liked} />
      </button>
      {likesOpen && (
        <Likes
          path={`/api/interactions/comments/${comment.id}/likes`}
          onClose={() => setLikesOpen(false)}
        />
      )}
    </li>
  );
}
type LikesPage = { items: { handle: string }[]; next: string | null };
function Likes({ path, onClose }: { path: string; onClose: () => void }) {
  const [earlier, setEarlier] = useState<LikesPage['items']>([]),
    [after, setAfter] = useState(''),
    [sentinel, setSentinel] = useState<Element | null>(null);
  const { data, error, loading, reload } = useApiResource<LikesPage>(
    `${path}?after=${encodeURIComponent(after)}`,
  );
  // Fetch the next page once the end of the list nears the bottom of the
  // dialog, which scrolls on its own. A fresh observer per loaded page reports
  // immediately, so short lists keep filling.
  const page = loading || error ? null : data;
  const more = page?.next
    ? () => {
        setEarlier((items) => [...items, ...page.items]);
        setAfter(page.next!);
      }
    : null;
  const latestMore = useRef(more);
  useEffect(() => {
    latestMore.current = more;
  });
  useEffect(() => {
    if (!page?.next || !sentinel || typeof IntersectionObserver === 'undefined')
      return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        latestMore.current?.();
      },
      { root: sentinel.closest('dialog'), rootMargin: '0px 0px 300px 0px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [page, sentinel]);
  // A like added or removed between reads can shift a person across pages.
  const seen = new Set<string>();
  const people = [...earlier, ...(data?.items ?? [])].filter(
    (person) => !seen.has(person.handle) && Boolean(seen.add(person.handle)),
  );
  return (
    <Dialog title="Liked by" onClose={onClose}>
      <ul className="people-list likers-list">
        {people.map((person) => (
          <li key={person.handle}>
            <PersonLink {...person} />
          </li>
        ))}
      </ul>
      <div ref={setSentinel} aria-hidden="true" />
      {loading && <p role="status">Loading likes…</p>}
      {error && (
        <div>
          <p role="alert">{error}</p>
          <button onClick={reload}>Retry</button>
        </div>
      )}
      {data && people.length === 0 && <p>No likes to show.</p>}
      {more && typeof IntersectionObserver === 'undefined' && (
        <button onClick={more}>Show more</button>
      )}
    </Dialog>
  );
}
