import { useEffect, useState } from 'react';
import { useApiResource } from '../../api/useApiResource';
import { PersonLink } from '../../navigation/PersonLink';
type Page = {
  items: { handle: string }[];
  next: string | null;
};
export function Discover() {
  const [input, setInput] = useState(''),
    [query, setQuery] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setQuery(input.trim().toLowerCase()), 350);
    return () => clearTimeout(timer);
  }, [input]);
  return (
    <>
      <label className="field-label" htmlFor="find-person">
        Search by username or name
      </label>
      <input
        id="find-person"
        type="search"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        maxLength={60}
        autoComplete="off"
      />
      <p className="field-help">Enter at least 3 characters.</p>
      {input.trim().toLowerCase() !== query ? (
        <p role="status">Updating search…</p>
      ) : query.length > 0 && query.length < 3 ? (
        <p>Keep typing to search.</p>
      ) : (
        <Directory key={query} query={query} />
      )}
    </>
  );
}
function Directory({ query }: { query: string }) {
  const [seed] = useState(() => crypto.randomUUID().replaceAll('-', '')),
    [earlier, setEarlier] = useState<Page['items']>([]),
    [after, setAfter] = useState(''),
    [sentinel, setSentinel] = useState<Element | null>(null);
  const { data, error, loading, reload } = useApiResource<Page>(
    `/api/people/discover?${new URLSearchParams({ q: query, seed, after })}`,
  );
  // Fetch the next page once the end of the list nears the viewport. A fresh
  // observer per loaded page reports immediately, so short lists keep filling.
  useEffect(() => {
    const page = loading ? null : data;
    if (!page?.next || !sentinel || typeof IntersectionObserver === 'undefined')
      return;
    const next = page.next;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        setEarlier((items) => [...items, ...page.items]);
        setAfter(next);
      },
      { rootMargin: '0px 0px 600px 0px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [data, loading, sentinel]);
  const people = [...earlier, ...(data?.items ?? [])];
  return (
    <>
      <ul className="people-list">
        {people.map((person) => (
          <li key={person.handle}>
            <PersonLink {...person} />
          </li>
        ))}
      </ul>
      <div ref={setSentinel} aria-hidden="true" />
      {loading && <p role="status">Finding people…</p>}
      {error && (
        <>
          <p role="alert">{error}</p>
          <button onClick={reload}>Retry</button>
        </>
      )}
      {data && people.length === 0 && <p>No people found.</p>}
    </>
  );
}
