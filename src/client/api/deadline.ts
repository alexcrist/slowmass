// Bound browser/API work, including transports which ignore AbortSignal.
export function withDeadline<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
  options: { milliseconds: number; message: string } = {
    milliseconds: 15_000,
    message: 'The browser took too long. Please try again.',
  },
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  let cancel: () => void;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      cancel = () => reject(new Error('Cancelled'));
      timer = setTimeout(
        () => reject(new Error(options.message)),
        options.milliseconds,
      );
      if (signal?.aborted) cancel();
      else signal?.addEventListener('abort', cancel, { once: true });
    }),
  ]).finally(() => {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  });
}
