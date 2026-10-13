import { createContext, useContext, useState, type ReactNode } from 'react';

const PageHistory = createContext<Map<string, string[]> | null>(null);

// Remember cursors, never private responses. Returning to a list reauthorizes it.
export function PageHistoryProvider({ children }: { children: ReactNode }) {
  const [pages] = useState(() => new Map<string, string[]>());
  return <PageHistory value={pages}>{children}</PageHistory>;
}

export function usePageHistory(key: string) {
  const pages = useContext(PageHistory);
  const [history, setHistory] = useState(() => pages?.get(key) ?? ['']);
  function remember(next: string[]) {
    if (pages) {
      pages.delete(key);
      pages.set(key, next);
      if (pages.size > 50) pages.delete(pages.keys().next().value!);
    }
    setHistory(next);
  }
  return [history, remember] as const;
}
