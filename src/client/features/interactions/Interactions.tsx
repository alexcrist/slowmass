import {
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
import { profileHref } from '../../navigation';
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
type Page = { items: Comment[]; next: string | null };
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
        <div className="reaction-pair">
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
  const after = history[history.length - 1];
  const [confirming, setConfirming] = useState<Comment | null>(null);
  const {
    data: page,
    error: loadError,
    loading,
    reload,
    refresh,
  } = useApiResource<Page>(
    `/api/interactions/${postId}/comments?after=${encodeURIComponent(after)}`,
  );
  const comments = useRef<HTMLDivElement>(null);
  const pendingReveal = useRef(revealOnOpen);
  useLayoutEffect(() => {
    // Measure the loaded thread once per button opening, never on paging,
    // editing, or count refreshes. Initially expanded detail pages stay put.
    if (loading || !pendingReveal.current) return;
    pendingReveal.current = false;
    const composer = comments.current?.querySelector('.composer');
    if (composer && commentButton.current)
      return revealCommentComposer(commentButton.current, composer);
  }, [loading, commentButton]);
  // An empty first page needs no message: the composer takes the first
  // comment's place. A later page can empty out after deletions.
  const empty = !loading && page?.items.length === 0;
  async function add(event: FormEvent) {
    event.preventDefault();
    if (busy || loading || !body.trim()) return;
    setBusy(true);
    setError('');
    try {
      await api(
        `/api/interactions/${postId}/comments`,
        jsonRequest('POST', { id, body }),
      );
      setBody('');
      setId(crypto.randomUUID());
      if (after) setHistory(['']);
      else refresh();
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
    if (busy || loading) return;
    setBusy(true);
    setError('');
    try {
      await api(`/api/interactions/comments/${id}`, { method: 'DELETE' });
      setConfirming(null);
      refresh((current) => ({
        ...current,
        items: current.items.filter((comment) => comment.id !== id),
      }));
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
      {loading && !page && <p role="status">Loading comments…</p>}
      {empty && after && <p>No comments on this page.</p>}
      <ul className="comment-list">
        {page?.items.map((comment) => (
          <CommentRow
            key={comment.id}
            comment={comment}
            busy={busy || loading}
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
      <nav className="actions" aria-label="Comment pages">
        {history.length > 1 && (
          <button
            disabled={busy || loading}
            onClick={() => {
              setHistory(history.slice(0, -1));
            }}
          >
            Newer comments
          </button>
        )}
        {page?.next && (
          <button
            disabled={busy || loading}
            onClick={() => {
              setHistory([...history, page.next!]);
            }}
          >
            Older comments
          </button>
        )}
      </nav>
      <Composer
        label="Add a comment"
        placeholder={
          empty && !after ? 'Add the first comment…' : 'Add a comment…'
        }
        maxLength={1000}
        value={body}
        busy={busy}
        canSubmit={!loading}
        submitLabel="Post comment"
        pendingLabel="Posting comment"
        onChange={(value) => {
          setBody(value);
          setId(crypto.randomUUID());
        }}
        onSubmit={(e) => void add(e)}
      />
      {error && !confirming && <p role="alert">{error}</p>}
      {loadError && (
        <div>
          <p role="alert">{loadError}</p>
          <button onClick={reload}>Retry</button>
        </div>
      )}
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
        <p className="comment-text">
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
function Likes({ path, onClose }: { path: string; onClose: () => void }) {
  const [history, setHistory] = useState(['']);
  const after = history[history.length - 1];
  const {
    data: page,
    error,
    loading,
    reload,
  } = useApiResource<{
    items: { handle: string }[];
    next: string | null;
  }>(`${path}?after=${encodeURIComponent(after)}`);
  return (
    <Dialog title="Liked by" onClose={onClose}>
      {loading && <p role="status">Loading likes…</p>}
      {error && (
        <div>
          <p role="alert">{error}</p>
          <button onClick={reload}>Retry</button>
        </div>
      )}
      <ul className="people-list likers-list">
        {page?.items.map((person) => (
          <li key={person.handle}>
            <PersonLink {...person} />
          </li>
        ))}
      </ul>
      {page?.items.length === 0 && <p>No likes to show.</p>}
      <nav className="actions" aria-label="Like pages">
        {history.length > 1 && (
          <button
            disabled={loading}
            onClick={() => {
              setHistory(history.slice(0, -1));
            }}
          >
            Previous
          </button>
        )}
        {page?.next && (
          <button
            disabled={loading}
            onClick={() => {
              setHistory([...history, page.next!]);
            }}
          >
            Next
          </button>
        )}
      </nav>
    </Dialog>
  );
}
