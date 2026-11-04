import type { ScrollPages } from './useScrollPages';

// The end of a `useScrollPages` list: the sentinel that requests the next
// page, its loading status, a failed page's Retry, and the fallback button
// for browsers without IntersectionObserver.
export function ScrollPagesEnd({
  pages: { sentinel, appending, loadError, retry, more: next },
  loading,
  more,
  disabled = false,
}: {
  pages: Pick<
    ScrollPages<unknown>,
    'sentinel' | 'appending' | 'loadError' | 'retry' | 'more'
  >;
  // Status shown while the next page loads, e.g. “Loading more posts…”.
  loading: string;
  // Fallback button label, e.g. “Show more posts”.
  more: string;
  disabled?: boolean;
}) {
  return (
    <>
      <div ref={sentinel} aria-hidden="true" />
      {/* Empty unless something shows, so lists can space it with :empty. */}
      <div className="actions">
        {appending && <p role="status">{loading}</p>}
        {loadError && (
          <>
            <p role="alert" className="error-message">
              {loadError}
            </p>
            <button onClick={retry}>Retry</button>
          </>
        )}
        {next && (
          <button disabled={disabled} onClick={next}>
            {more}
          </button>
        )}
      </div>
    </>
  );
}
