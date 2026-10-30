import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { useApiResource } from '../../api/useApiResource';
import { PersonLink } from '../../navigation/PersonLink';
type Page = {
  items: { handle: string }[];
  next: string | null;
};
type FindHistory = {
  input: string;
  query: string;
  seed: string;
  depth: number;
};
const FindHistoryContext = createContext<{
  read: () => FindHistory;
  remember: (update: Partial<FindHistory>) => void;
} | null>(null);
export function DiscoverHistoryProvider({ children }: { children: ReactNode }) {
  const [history] = useState(() => {
    const value: FindHistory = {
      input: '',
      query: '',
      seed: crypto.randomUUID().replaceAll('-', ''),
      depth: 1,
    };
    return {
      read: () => value,
      remember: (update: Partial<FindHistory>) => {
        Object.assign(value, update);
      },
    };
  });
  return <FindHistoryContext value={history}>{children}</FindHistoryContext>;
}
export function Discover() {
  const history = useContext(FindHistoryContext);
  const [input, setInput] = useState(history?.read().input ?? ''),
    [query, setQuery] = useState(history?.read().query ?? '');
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
        onChange={(e) => {
          history?.remember({ input: e.target.value });
          setInput(e.target.value);
        }}
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
  const history = useContext(FindHistoryContext);
  const [saved] = useState(() =>
    history?.read().query === query
      ? { seed: history.read().seed, depth: history.read().depth }
      : { seed: crypto.randomUUID().replaceAll('-', ''), depth: 1 },
  );
  const seed = saved.seed;
  const [depth, setDepth] = useState(1);
  useEffect(() => {
    history?.remember({
      query,
      seed,
      depth: Math.max(saved.depth, depth),
    });
  }, [history, query, seed, saved.depth, depth]);
  const [earlier, setEarlier] = useState<Page['items']>([]),
    [after, setAfter] = useState(''),
    [sentinel, setSentinel] = useState<Element | null>(null);
  const { data, error, loading, reload } = useApiResource<Page>(
    `/api/people/discover?${new URLSearchParams({ q: query, seed, after })}`,
  );
  // Fetch the next page once the end of the list nears the viewport. A fresh
  // observer per loaded page reports immediately, so short lists keep filling.
  useEffect(() => {
    const page = loading ? null : data;
    if (!page?.next) return;
    const next = page.next;
    const append = () => {
      setEarlier((items) => [...items, ...page.items]);
      setAfter(next);
      setDepth((value) => value + 1);
    };
    // Rebuild previously loaded pages from fresh authorized reads, using the
    // same shuffle seed. Do not retain directory responses between visits.
    if (depth < saved.depth) {
      append();
      return;
    }
    if (!sentinel || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        append();
      },
      { rootMargin: '0px 0px 600px 0px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [data, loading, sentinel, depth, saved.depth]);
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
