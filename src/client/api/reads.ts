type Read = {
  controller: AbortController;
  promise: Promise<unknown>;
  subscribers: number;
};
const pending = new Map<string, Read>();

// A mutation or session change starts a new set of reads. Existing callers keep
// their cancellation/response ownership; later callers cannot join older work.
export function separateReads() {
  pending.clear();
}

export function sharedRead(
  path: string,
  signal: AbortSignal | null | undefined,
  load: (signal: AbortSignal) => Promise<unknown>,
): Promise<unknown> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  let read = pending.get(path);
  if (!read) {
    const controller = new AbortController();
    const timer = setTimeout(
      () =>
        controller.abort(
          new Error('This request took too long. Please try again.'),
        ),
      15_000,
    );
    const promise = new Promise<unknown>((resolve, reject) => {
      controller.signal.addEventListener(
        'abort',
        () => reject(controller.signal.reason),
        { once: true },
      );
      void load(controller.signal).then(resolve, reject);
    });
    const created: Read = {
      controller,
      subscribers: 0,
      promise: promise.finally(() => {
        clearTimeout(timer);
        if (pending.get(path) === created) pending.delete(path);
      }),
    };
    read = created;
    pending.set(path, read);
  }
  const current = read;
  current.subscribers++;
  return new Promise((resolve, reject) => {
    let finished = false;
    function finish(complete: () => void) {
      if (finished) return;
      finished = true;
      signal?.removeEventListener('abort', cancel);
      current.subscribers--;
      if (!current.subscribers) {
        if (pending.get(path) === current) pending.delete(path);
        current.controller.abort();
      }
      complete();
    }
    const cancel = () => finish(() => reject(signal?.reason));
    signal?.addEventListener('abort', cancel, { once: true });
    current.promise.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    );
  });
}
