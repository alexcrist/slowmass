import { useEffect, useState } from 'react';
import { useApiResource } from '../../api/useApiResource';
import { PersonLink } from '../../navigation/PersonLink';
type Page = {
  items: { handle: string; hasAvatar: number }[];
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
      <p className="field-help">
        Enter at least 3 characters. Partial names and skipped letters work too.
      </p>
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
    [history, setHistory] = useState(['']);
  const after = history[history.length - 1];
  const { data, error, loading, reload } = useApiResource<Page>(
    `/api/people/discover?${new URLSearchParams({ q: query, seed, after })}`,
  );
  return (
    <>
      {loading && <p role="status">Finding people…</p>}
      {error && (
        <>
          <p role="alert">{error}</p>
          <button onClick={reload}>Retry</button>
        </>
      )}
      {data?.items.length === 0 && <p>No people found.</p>}
      <ul className="people-list">
        {data?.items.map((person) => (
          <li key={person.handle}>
            <PersonLink {...person} />
          </li>
        ))}
      </ul>
      <nav className="actions" aria-label="People pages">
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
        {data?.next && (
          <button
            disabled={loading}
            onClick={() => {
              setHistory([...history, data.next!]);
            }}
          >
            Next
          </button>
        )}
      </nav>
    </>
  );
}
