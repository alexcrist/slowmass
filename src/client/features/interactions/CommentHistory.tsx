import { createContext, useContext, useState, type ReactNode } from 'react';

import { currentRoute } from '../../navigation';

type Thread = { open: boolean; pages: string[] };
const CommentHistory = createContext<Map<string, Thread> | null>(null);
export function CommentHistoryProvider({ children }: { children: ReactNode }) {
  const [threads] = useState(() => new Map<string, Thread>());
  return <CommentHistory value={threads}>{children}</CommentHistory>;
}
export function useCommentHistory(postId: string, initiallyOpen: boolean) {
  const threads = useContext(CommentHistory);
  const key = threads ? `${currentRoute()}:${postId}` : postId;
  const [thread, setThread] = useState<Thread>(
    () => threads?.get(key) ?? { open: initiallyOpen, pages: [''] },
  );
  function remember(next: Thread) {
    threads?.delete(key);
    threads?.set(key, next);
    if (threads && threads.size > 100)
      threads.delete(threads.keys().next().value!);
    setThread(next);
  }
  return [thread, remember] as const;
}
