import { useId, useState, type FormEvent } from 'react';
import { PersonLink } from '../../navigation/PersonLink';
import { profileHref } from '../../navigation';
import { api, jsonRequest } from '../../api';
import { useApiResource } from '../../api/useApiResource';
type Counts = { likeCount: number; commentCount: number; liked: number };
type Comment = {
  id: string;
  body: string;
  createdAt: number;
  handle: string;
  displayName: string;
  canDelete: number;
};
type Page = { items: Comment[]; next: string | null };
export function Interactions({
  postId,
  initial,
}: {
  postId: string;
  initial: Counts;
}) {
  const [counts, setCounts] = useState(initial),
    [open, setOpen] = useState(false),
    [likesOpen, setLikesOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function refresh() {
    const data = await api<{ post: Counts }>(`/api/posts/${postId}`);
    setCounts(data.post);
  }
  async function like() {
    setBusy(true);
    setError('');
    try {
      await api(`/api/interactions/${postId}/like`, {
        method: counts.liked ? 'DELETE' : 'PUT',
      });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update like.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="Likes and comments">
      <div className="post-interactions">
        <button
          className="icon-button"
          disabled={busy}
          aria-label={counts.liked ? 'Unlike photo' : 'Like photo'}
          aria-pressed={Boolean(counts.liked)}
          onClick={() => void like()}
        >
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            fill={counts.liked ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeWidth="1.8"
          >
            <path d="M20 5c-3-3-6-1-8 1-2-2-5-4-8-1-4 4 1 9 8 15 7-6 12-11 8-15Z" />
          </svg>
        </button>
        {counts.likeCount > 0 && (
          <button
            className="count-button"
            aria-label={`See ${counts.likeCount} likes`}
            aria-expanded={likesOpen}
            onClick={() => setLikesOpen(!likesOpen)}
          >
            {counts.likeCount}
          </button>
        )}
        <button
          className="icon-button"
          aria-label={open ? 'Hide comments' : 'Show comments'}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
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
      {likesOpen && (
        <Likes key={`${postId}:${counts.likeCount}`} postId={postId} />
      )}
      {error && <p role="alert">{error}</p>}
      {open && <Comments postId={postId} onChange={refresh} />}
    </section>
  );
}
function Comments({
  postId,
  onChange,
}: {
  postId: string;
  onChange: () => Promise<void>;
}) {
  const label = useId(),
    [history, setHistory] = useState(['']),
    [body, setBody] = useState(''),
    [id, setId] = useState(() => crypto.randomUUID()),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const after = history[history.length - 1];
  const {
    data: page,
    error: loadError,
    loading,
    reload,
  } = useApiResource<Page>(
    `/api/interactions/${postId}/comments?after=${encodeURIComponent(after)}`,
  );
  async function add(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api(
        `/api/interactions/${postId}/comments`,
        jsonRequest('POST', { id, body }),
      );
      setBody('');
      setId(crypto.randomUUID());
      setHistory(['']);
      reload();
      await onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add comment.');
    } finally {
      setBusy(false);
    }
  }
  async function remove(id: string) {
    setBusy(true);
    setError('');
    try {
      await api(`/api/interactions/comments/${id}`, { method: 'DELETE' });
      reload();
      await onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete comment.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      {loading && <p role="status">Loading comments…</p>}
      {page?.items.length === 0 && <p>No comments on this page.</p>}
      <ul className="comment-list">
        {page?.items.map((comment) => (
          <li key={comment.id}>
            <a href={profileHref(comment.handle)}>@{comment.handle}</a>
            <p className="bio">{comment.body}</p>
            <time dateTime={new Date(comment.createdAt).toISOString()}>
              {new Date(comment.createdAt).toLocaleString()}
            </time>
            {Boolean(comment.canDelete) && (
              <button
                disabled={busy}
                className="text-button"
                onClick={() => void remove(comment.id)}
              >
                Delete comment
              </button>
            )}
          </li>
        ))}
      </ul>
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
      <form onSubmit={(e) => void add(e)}>
        <label className="field-label" htmlFor={label}>
          Add a comment
        </label>
        <textarea
          id={label}
          required
          maxLength={1000}
          rows={2}
          value={body}
          disabled={busy}
          onChange={(e) => {
            setBody(e.target.value);
            setId(crypto.randomUUID());
          }}
        />
        <button disabled={busy || !body.trim()}>Post comment</button>
      </form>
      {error && <p role="alert">{error}</p>}
      {loadError && (
        <div>
          <p role="alert">{loadError}</p>
          <button onClick={reload}>Reload comments</button>
        </div>
      )}
    </div>
  );
}
function Likes({ postId }: { postId: string }) {
  const [history, setHistory] = useState(['']);
  const after = history[history.length - 1];
  const {
    data: page,
    error,
    loading,
    reload,
  } = useApiResource<{
    items: { handle: string; hasAvatar: number }[];
    next: string | null;
  }>(`/api/interactions/${postId}/likes?after=${encodeURIComponent(after)}`);
  return (
    <section aria-label="People who liked this photo">
      <h3>Liked by</h3>
      {loading && <p role="status">Loading likes…</p>}
      {error && (
        <div>
          <p role="alert">{error}</p>
          <button onClick={reload}>Retry</button>
        </div>
      )}
      <ul className="people-list">
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
    </section>
  );
}
