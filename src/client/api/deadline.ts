// Bound browser/API work, including transports which ignore AbortSignal.
export function withDeadline<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  let cancel: () => void;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      cancel = () => reject(new Error('Cancelled'));
      timer = setTimeout(
        () => reject(new Error('The browser took too long. Please try again.')),
        15_000,
      );
      if (signal?.aborted) cancel();
      else signal?.addEventListener('abort', cancel, { once: true });
    }),
  ]).finally(() => {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  });
}
