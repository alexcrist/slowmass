import { useEffect, useState } from 'react';
import { api } from '../../api';
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
    [history, setHistory] = useState(['']),
    [data, setData] = useState<Page | null>(null),
    [error, setError] = useState(''),
    [version, setVersion] = useState(0);
  const after = history[history.length - 1];
  useEffect(() => {
    const controller = new AbortController();
    api<Page>(
      `/api/people/discover?${new URLSearchParams({ q: query, seed, after })}`,
      { signal: controller.signal },
    )
      .then((data) => {
        if (!controller.signal.aborted) {
          setData(data);
          setError('');
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [query, seed, after, version]);
  return (
    <>
      {!data && !error && <p role="status">Finding people…</p>}
      {error && (
        <>
          <p role="alert">{error}</p>
          <button onClick={() => setVersion((v) => v + 1)}>Retry</button>
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
            onClick={() => {
              setData(null);
              setHistory(history.slice(0, -1));
            }}
          >
            Previous
          </button>
        )}
        {data?.next && (
          <button
            onClick={() => {
              setData(null);
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
