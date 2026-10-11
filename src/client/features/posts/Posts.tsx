import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Interactions } from '../interactions/Interactions';
import { api, jsonRequest } from '../../api';
type Post = {
  id: string;
  caption: string;
  altText: string;
  width: number;
  height: number;
  publishedAt: number;
  handle: string;
  displayName: string;
  isOwner: boolean;
  mediaUrl: string;
  likeCount: number;
  commentCount: number;
  liked: number;
};
type Page = { items: Post[]; next: string | null };
export function PostList({ handle }: { handle?: string }) {
  const [history, setHistory] = useState(['']);
  const [page, setPage] = useState<Page | null>(null);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  const cursor = history[history.length - 1];
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (handle) params.set('handle', handle);
    if (cursor) params.set('cursor', cursor);
    api<Page>(`/api/posts?${params}`, { signal: controller.signal })
      .then((result) => {
        setPage(result);
        setError('');
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(error.message);
      });
    return () => controller.abort();
  }, [handle, cursor, version]);
  function refresh() {
    setPage(null);
    setHistory(['']);
    setVersion((value) => value + 1);
  }
  return (
    <>
      <button type="button" onClick={refresh}>
        Refresh posts
      </button>
      {!page && !error && <p role="status">Loading posts…</p>}
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      {page?.items.length === 0 && (
        <p>
          {handle
            ? 'No photos on this page.'
            : 'No posts on this page. Posts from accepted follows appear here.'}
        </p>
      )}
      {page?.items.map((post) => (
        <PostCard
          key={post.id}
          post={post}
          onDelete={() =>
            setPage((current) =>
              current
                ? {
                    ...current,
                    items: current.items.filter((item) => item.id !== post.id),
                  }
                : current,
            )
          }
        />
      ))}
      {page && (
        <nav className="actions" aria-label="Post pages">
          {history.length > 1 && (
            <button
              onClick={() => {
                setPage(null);
                setHistory(history.slice(0, -1));
              }}
            >
              Newer
            </button>
          )}
          {page.next ? (
            <button
              onClick={() => {
                setPage(null);
                setHistory([...history, page.next!]);
              }}
            >
              Older
            </button>
          ) : (
            <p>End of posts.</p>
          )}
        </nav>
      )}
    </>
  );
}
function PostCard({ post, onDelete }: { post: Post; onDelete: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function remove() {
    setBusy(true);
    setError('');
    try {
      await api(`/api/posts/${post.id}`, { method: 'DELETE' });
      onDelete();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Deletion failed.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="post">
      <header>
        <strong>{post.displayName}</strong>{' '}
        <span className="handle">@{post.handle}</span>
        <time dateTime={new Date(post.publishedAt).toISOString()}>
          {new Date(post.publishedAt).toLocaleString()}
        </time>
      </header>
      <img
        src={post.mediaUrl}
        alt={post.altText || `Photo by ${post.displayName}`}
        width={post.width}
        height={post.height}
        loading="lazy"
        decoding="async"
      />
      {post.caption && <p className="bio">{post.caption}</p>}
      <Interactions
        key={`${post.id}:${post.likeCount}:${post.commentCount}:${post.liked}`}
        postId={post.id}
        initial={post}
      />
      {post.isOwner &&
        (confirm ? (
          <div>
            <p>Delete this photo? This cannot be undone.</p>
            <div className="actions">
              <button disabled={busy} onClick={() => void remove()}>
                Delete photo
              </button>
              <button disabled={busy} onClick={() => setConfirm(false)}>
                Keep photo
              </button>
            </div>
          </div>
        ) : (
          <button className="text-button" onClick={() => setConfirm(true)}>
            Delete
          </button>
        ))}
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
    </article>
  );
}
export function Compose({ onPublished }: { onPublished: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [caption, setCaption] = useState('');
  const [altText, setAltText] = useState('');
  const [id, setId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  useEffect(() => () => controller.current?.abort(), []);
  async function publish(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    setBusy(true);
    setError('');
    controller.current = new AbortController();
    try {
      if (file.size > 8 * 1024 * 1024)
        throw new Error('Choose a photo smaller than 8 MB.');
      const draft = await api<{ state: string }>('/api/posts', {
        ...jsonRequest('POST', { id, caption, altText }),
        signal: controller.current.signal,
      });
      if (draft.state !== 'published')
        await api(`/api/posts/${id}/photo`, {
          method: 'PUT',
          headers: { 'Content-Type': file.type || 'application/octet-stream' },
          body: file,
          signal: controller.current.signal,
        });
      onPublished();
    } catch (error) {
      if (!controller.current?.signal.aborted)
        setError(
          error instanceof Error
            ? error.message
            : 'Upload failed. You can retry this upload.',
        );
    } finally {
      setBusy(false);
    }
  }
  async function cancel() {
    controller.current?.abort();
    let confirmed = false;
    try {
      await api(`/api/posts/${id}`, { method: 'DELETE' });
      confirmed = true;
    } catch {
      /* An interrupted request may have reached the server. */
    }
    setId(crypto.randomUUID());
    setBusy(false);
    setError(
      confirmed
        ? 'Upload cancelled.'
        : 'Cancellation could not be confirmed. Check My photos before trying again.',
    );
  }
  return (
    <form onSubmit={(event) => void publish(event)}>
      <label htmlFor="post-file" className="field-label">
        Photo
      </label>
      <input
        id="post-file"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        required
        disabled={busy}
        onChange={(event) => {
          setFile(event.target.files?.[0] ?? null);
          setId(crypto.randomUUID());
          setError('');
          setPreview(
            event.target.files?.[0]
              ? URL.createObjectURL(event.target.files[0])
              : '',
          );
        }}
      />
      <p className="field-help">
        One still JPEG, PNG, or WebP. Up to 8 MB and 40 megapixels.
      </p>
      {file && preview && (
        <img
          className="photo-preview"
          src={preview}
          alt="Selected photo preview"
        />
      )}
      <label htmlFor="caption" className="field-label">
        Caption
      </label>
      <textarea
        id="caption"
        rows={3}
        maxLength={2000}
        value={caption}
        disabled={busy}
        onChange={(event) => setCaption(event.target.value)}
      />
      <label htmlFor="alt-text" className="field-label">
        Photo description (optional)
      </label>
      <textarea
        id="alt-text"
        rows={2}
        maxLength={500}
        value={altText}
        disabled={busy}
        onChange={(event) => setAltText(event.target.value)}
      />
      <p className="field-help">
        Describe the photo for people using screen readers.
      </p>
      <button className="primary-button" disabled={busy || !file}>
        {busy ? 'Uploading and processing…' : 'Publish photo'}
      </button>
      {busy && (
        <button
          type="button"
          className="text-button"
          onClick={() => void cancel()}
        >
          Cancel upload
        </button>
      )}
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
    </form>
  );
}

export function PostDetail({ id }: { id: string }) {
  const [post, setPost] = useState<Post | null>(null),
    [error, setError] = useState(''),
    [deleted, setDeleted] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    api<{ post: Post }>(`/api/posts/${id}`, { signal: controller.signal })
      .then((data) => setPost(data.post))
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [id]);
  return deleted ? (
    <p>Photo deleted.</p>
  ) : error ? (
    <p role="alert">{error}</p>
  ) : post ? (
    <PostCard post={post} onDelete={() => setDeleted(true)} />
  ) : (
    <p role="status">Loading photo…</p>
  );
}
