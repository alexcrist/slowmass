import { useState } from 'react';
import { PersonLink } from '../../navigation/PersonLink';
import { postHref, profileHref } from '../../navigation';
import { usePageHistory } from '../../navigation/PageHistory';
import { ScrollPagesEnd } from '../../navigation/ScrollPagesEnd';
import { useScrollPages } from '../../navigation/useScrollPages';
import { Interactions } from '../interactions';
import { useSeenActivity } from '../notifications';
import { useApiResource } from '../../api/useApiResource';
import { RelativeTime } from '../../ui/RelativeTime';
import { PostActions } from './PostActions';
import { FocusedPhoto } from './FocusedPhoto';
import { captionParagraphs } from './caption';
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
const identify = (post: Post) => post.id;
export function PostList({
  handle,
  grid = false,
  pending = false,
}: {
  handle?: string;
  grid?: boolean;
  pending?: boolean;
}) {
  const pages = useScrollPages({
    history: usePageHistory(handle ? `posts:profile:${handle}` : 'posts:feed'),
    path: (cursor) => {
      const params = new URLSearchParams();
      if (handle) params.set('handle', handle);
      if (cursor) params.set('cursor', cursor);
      return `/api/posts?${params}`;
    },
    identify,
  });
  const { items, loading, complete, update } = pages;
  if (pending) return null;
  return (
    <>
      {loading && !items && <p role="status">Loading posts…</p>}
      {!loading && items?.length === 0 && (
        <p>
          {handle
            ? 'No photos yet.'
            : 'No posts yet. Posts from accepted follows appear here.'}
        </p>
      )}
      {grid ? (
        <div className="post-grid">
          {items?.map((post, index) => (
            <a
              key={post.id}
              className="grid-photo"
              href={postHref(post.id)}
              aria-label={
                post.caption
                  ? `Open post: ${post.caption.slice(0, 100)}`
                  : `Open post by ${post.handle}`
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
        items?.map((post, index) => (
          <PostCard
            key={post.id}
            post={post}
            onDelete={() =>
              update((items) => items.filter((item) => item.id !== post.id))
            }
            priority={index === 0}
          />
        ))
      )}
      <ScrollPagesEnd
        pages={pages}
        loading="Loading more posts…"
        more="Show more posts"
      />
      {complete && (
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
  const paragraphs = captionParagraphs(caption);
  // Seeing the photo reads its new-photo alert.
  const seen = useSeenActivity<HTMLImageElement>({ keys: [`post:${post.id}`] });
  const photo = (
    <img
      ref={seen}
      className="post-photo"
      src={post.mediaUrl}
      alt={post.altText || `Photo by ${post.handle}`}
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
          alt={post.altText || `Photo by ${post.handle}`}
          width={post.width}
          height={post.height}
        >
          {photo}
        </FocusedPhoto>
      ) : (
        <a
          className="post-photo-link"
          href={postHref(post.id)}
          aria-label={`Open post by ${post.handle}`}
        >
          {photo}
        </a>
      )}
      <div className="post-body">
        <Interactions
          key={post.id}
          postId={post.id}
          initial={post}
          commentsInitiallyOpen={focused}
          caption={
            paragraphs.length > 0 && (
              <div className="post-caption">
                {paragraphs.map((paragraph, index) => (
                  <p key={index}>
                    {index === 0 && (
                      <>
                        <a href={profileHref(post.handle)}>
                          <strong>{post.handle}</strong>
                        </a>{' '}
                      </>
                    )}
                    {paragraph}
                  </p>
                ))}
              </div>
            )
          }
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
