import { useState } from 'react';
import { PersonLink } from '../../navigation/PersonLink';
import { postHref } from '../../navigation';
import { usePageHistory } from '../../navigation/PageHistory';
import { Interactions } from '../interactions';
import { useApiResource } from '../../api/useApiResource';
import { RelativeTime } from '../../ui/RelativeTime';
import { PostActions } from './PostActions';
import { FocusedPhoto } from './FocusedPhoto';
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
