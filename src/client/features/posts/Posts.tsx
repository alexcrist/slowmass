import { useEffect, useRef, useState, type FormEvent } from 'react';
import { PersonLink } from '../../navigation/PersonLink';
import { postHref } from '../../navigation';
import { usePageHistory } from '../../navigation/PageHistory';
import { Interactions } from '../interactions';
import { api, ApiError, jsonRequest } from '../../api';
import {
  PhotoProgress,
  type PhotoProgressState,
} from '../../images/PhotoProgress';
import { useApiResource } from '../../api/useApiResource';
import { RelativeTime } from '../../ui/RelativeTime';
import { PostActions } from './PostActions';
import { PostCropEditor } from './PostCropEditor';
import { FocusedPhoto } from './FocusedPhoto';
import { fullPhoto, type Rectangle } from './crop';
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
  thumbnailUrl: string;
  likeCount: number;
  commentCount: number;
  liked: number;
};
type Page = { items: Post[]; next: string | null };
export function PostList({
  handle,
  grid = false,
  pending = false,
}: {
  handle?: string;
  grid?: boolean;
  pending?: boolean;
}) {
  const [history, setHistory] = usePageHistory(
    handle ? `posts:profile:${handle}` : 'posts:feed',
  );
  const cursor = history[history.length - 1];
  const params = new URLSearchParams();
  if (handle) params.set('handle', handle);
  if (cursor) params.set('cursor', cursor);
  const {
    data: page,
    error,
    loading,
    reload,
    refresh,
  } = useApiResource<Page>(`/api/posts?${params}`);
  if (pending) return null;
  return (
    <>
      {loading && !page && <p role="status">Loading posts…</p>}
      {error && (
        <div>
          <p role="alert" className="error-message">
            {error}
          </p>
          <button onClick={reload}>Retry</button>
        </div>
      )}
      {!loading && page?.items.length === 0 && (
        <p>
          {handle
            ? 'No photos on this page.'
            : 'No posts on this page. Posts from accepted follows appear here.'}
        </p>
      )}
      {grid ? (
        <div className="post-grid">
          {page?.items.map((post, index) => (
            <a
              key={post.id}
              className="grid-photo"
              href={postHref(post.id)}
              aria-label={
                post.caption
                  ? `Open post: ${post.caption.slice(0, 100)}`
                  : `Open post by @${post.handle}`
              }
            >
              <img
                src={post.thumbnailUrl}
                alt={post.altText || ''}
                width={post.width}
                height={post.height}
                loading={index < 3 ? 'eager' : 'lazy'}
                decoding="async"
              />
            </a>
          ))}
        </div>
      ) : (
        page?.items.map((post, index) => (
          <PostCard
            key={post.id}
            post={post}
            onDelete={() =>
              refresh((current) => ({
                ...current,
                items: current.items.filter((item) => item.id !== post.id),
              }))
            }
            priority={index === 0}
          />
        ))
      )}
      {page && (
        <nav className="actions" aria-label="Post pages">
          {history.length > 1 && (
            <button
              disabled={loading}
              onClick={() => {
                setHistory(history.slice(0, -1));
              }}
            >
              Newer
            </button>
          )}
          {page.next ? (
            <button
              disabled={loading}
              onClick={() => {
                setHistory([...history, page.next!]);
              }}
            >
              Older
            </button>
          ) : !loading ? (
            <svg
              className="end-of-posts"
              role="img"
              aria-label="End of posts"
              width={48}
              height={16}
              viewBox="0 0 48 16"
              fill="none"
              stroke="currentColor"
              strokeWidth={1}
            >
              <path d="M0 8h48" />
            </svg>
          ) : null}
        </nav>
      )}
    </>
  );
}
function PostCard({
  post,
  onDelete,
  priority = true,
  focused = false,
}: {
  post: Post;
  onDelete: () => void;
  priority?: boolean;
  focused?: boolean;
}) {
  const [caption, setCaption] = useState(post.caption);
  const [sourceCaption, setSourceCaption] = useState(post.caption);
  if (sourceCaption !== post.caption) {
    setSourceCaption(post.caption);
    setCaption(post.caption);
  }
  const photo = (
    <img
      className="post-photo"
      src={post.mediaUrl}
      alt={post.altText || `Photo by @${post.handle}`}
      width={post.width}
      height={post.height}
      loading={priority ? 'eager' : 'lazy'}
      fetchPriority={priority ? 'high' : 'auto'}
      decoding="async"
    />
  );
  return (
    <article className="post" data-focused={focused || undefined}>
      <header>
        <PersonLink handle={post.handle} />
        <RelativeTime timestamp={post.publishedAt} />
        {post.isOwner && (
          <PostActions
            id={post.id}
            caption={caption}
            onEdited={setCaption}
            onDeleted={onDelete}
          />
        )}
      </header>
      {focused ? (
        <FocusedPhoto
          src={post.mediaUrl}
          alt={post.altText || `Photo by @${post.handle}`}
          width={post.width}
          height={post.height}
        >
          {photo}
        </FocusedPhoto>
      ) : (
        <a
          className="post-photo-link"
          href={postHref(post.id)}
          aria-label={`Open post by @${post.handle}`}
        >
          {photo}
        </a>
      )}
      <div className="post-body">
        {caption && <p className="bio">{caption}</p>}
        <Interactions
          key={post.id}
          postId={post.id}
          initial={post}
          commentsInitiallyOpen={focused}
        />
      </div>
    </article>
  );
}
export function Compose({ onPublished }: { onPublished: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [source, setSource] = useState<{ file: File; crop: Rectangle } | null>(
    null,
  );
  const [editing, setEditing] = useState<{
    file: File;
    crop: Rectangle;
  } | null>(null);
  const [caption, setCaption] = useState('');
  const [id, setId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [progress, setProgress] = useState<PhotoProgressState>({
    phase: 'starting',
  });
  const [submitted, setSubmitted] = useState<{ caption: string } | null>(null);
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
    if (!file || busy || controller.current || editing) return;
    setBusy(true);
    setProgress({ phase: 'starting' });
    setError('');
    const request = new AbortController();
    controller.current = request;
    try {
      if (file.size > 8 * 1024 * 1024)
        throw new Error('Choose a photo smaller than 8 MB.');
      const details = submitted ?? { caption };
      setSubmitted(details);
      const draft = await api<{ state: string }>('/api/posts', {
        ...jsonRequest('POST', { id, caption: details.caption, altText: '' }),
        signal: request.signal,
        timeoutMs: 30_000,
      });
      if (request.signal.aborted) return;
      if (draft.state !== 'published')
        await api(`/api/posts/${id}/photo`, {
          method: 'PUT',
          headers: { 'Content-Type': file.type || 'application/octet-stream' },
          body: file,
          signal: request.signal,
          onUploadProgress: (percent) => {
            if (!request.signal.aborted)
              setProgress({
                phase: percent === 100 ? 'processing' : 'uploading',
                percent,
              });
          },
        });
      if (!request.signal.aborted) onPublished();
    } catch (error) {
      if (!request.signal.aborted)
        setError(
          error instanceof Error
            ? error.message
            : 'Upload failed. You can retry this upload.',
        );
    } finally {
      if (controller.current === request) {
        controller.current = null;
        setBusy(false);
      }
    }
  }
  async function cancel() {
    if (cancelling) return;
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setBusy(true);
    setCancelling(true);
    setProgress({ phase: 'cancelling' });
    let confirmed = false;
    try {
      await api(`/api/posts/${id}`, {
        method: 'DELETE',
        signal: request.signal,
        timeoutMs: 30_000,
      });
      confirmed = true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) confirmed = true;
      /* An interrupted request may have reached the server. */
    }
    if (request.signal.aborted) return;
    controller.current = null;
    if (confirmed) {
      setId(crypto.randomUUID());
      setSubmitted(null);
    }
    setBusy(false);
    setCancelling(false);
    setError(
      confirmed
        ? 'Upload cancelled.'
        : 'Cancellation could not be confirmed. Check your profile before trying again.',
    );
  }
  return (
    <>
      <form className="post-compose" onSubmit={(event) => void publish(event)}>
        <label htmlFor="post-file" className="field-label">
          Photo
        </label>
        <input
          id="post-file"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={busy || submitted !== null}
          onChange={(event) => {
            const selected = event.target.files?.[0];
            event.target.value = '';
            if (selected) setEditing({ file: selected, crop: fullPhoto });
          }}
        />
        <p className="field-help">
          One still JPEG, PNG, or WebP. Up to 32 MB and 40 megapixels. Photos
          are resized automatically before upload.
        </p>
        {file && preview && (
          <>
            <img
              className="photo-preview"
              src={preview}
              alt="Selected photo preview"
            />
            <button
              type="button"
              className="text-button"
              disabled={busy || submitted !== null}
              onClick={() => setEditing(source)}
            >
              Adjust crop
            </button>
          </>
        )}
        <label htmlFor="caption" className="field-label">
          Caption
        </label>
        <textarea
          id="caption"
          rows={3}
          maxLength={2000}
          value={caption}
          disabled={busy || submitted !== null}
          onChange={(event) => setCaption(event.target.value)}
        />
        {busy && <PhotoProgress progress={progress} />}
        {!busy && submitted && (
          <p className="field-help">
            Retry to check this upload. Cancel it before changing the photo or
            caption.
          </p>
        )}
        <button className="primary-button" disabled={busy || !file}>
          {busy ? 'Saving…' : submitted ? 'Retry upload' : 'Publish photo'}
        </button>
        {(busy || submitted) && (
          <button
            type="button"
            className="text-button"
            disabled={cancelling}
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
      {editing && (
        <PostCropEditor
          file={editing.file}
          initial={editing.crop}
          onClose={() => setEditing(null)}
          onApply={(cropped, crop) => {
            setFile(cropped);
            setSource({ file: editing.file, crop });
            setPreview(URL.createObjectURL(cropped));
            setId(crypto.randomUUID());
            setSubmitted(null);
            setError('');
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

export function PostDetail({ id }: { id: string }) {
  const [deleted, setDeleted] = useState(false);
  const { data, error, reload } = useApiResource<{ post: Post }>(
    `/api/posts/${encodeURIComponent(id)}`,
  );
  const post = data?.post;
  return deleted ? (
    <p>Photo deleted.</p>
  ) : error ? (
    <div>
      <p role="alert">{error}</p>
      <button onClick={reload}>Retry</button>
    </div>
  ) : post ? (
    <PostCard
      key={post.id}
      post={post}
      focused
      onDelete={() => setDeleted(true)}
    />
  ) : (
    <p role="status">Loading photo…</p>
  );
}
