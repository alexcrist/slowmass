// A progress value of 100 means the request body was sent, not that it was saved.
// Same-origin XHR retains the browser's session cookies and Origin/CSRF checks.
export function uploadResponse(
  path: string,
  body: Blob,
  headers: HeadersInit | undefined,
  signal: AbortSignal | null | undefined,
  onProgress: (percent: number | null) => void,
) {
  return new Promise<Response>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let settled = false;
    let sent = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      xhr.upload.onprogress = null;
      xhr.upload.onload = null;
      xhr.onload = xhr.onerror = xhr.onabort = null;
      if (error) {
        reject(error);
        xhr.abort();
      } else {
        try {
          resolve(
            new Response(
              [204, 205, 304].includes(xhr.status) ? null : xhr.responseText,
              { status: xhr.status },
            ),
          );
        } catch {
          reject(
            new Error(
              'The upload response could not be read. Retry the same photo to check whether it saved.',
            ),
          );
        }
      }
    };
    const cancel = () => finish(new Error('Cancelled'));
    const timer = setTimeout(
      () =>
        finish(
          new Error(
            'This upload took too long to confirm. Check your connection, then retry the same photo to check whether it saved.',
          ),
        ),
      120_000,
    );
    if (signal?.aborted) return cancel();
    signal?.addEventListener('abort', cancel, { once: true });
    xhr.upload.onprogress = (event) => {
      if (!sent && !settled)
        onProgress(
          event.lengthComputable && event.total > 0
            ? Math.min(99, Math.floor((event.loaded / event.total) * 100))
            : null,
        );
    };
    xhr.upload.onload = () => {
      if (settled) return;
      sent = true;
      onProgress(100);
    };
    xhr.onload = () =>
      finish(
        xhr.status === 0
          ? new Error(
              'The connection was interrupted. Retry the same photo to check whether it saved.',
            )
          : undefined,
      );
    xhr.onerror = () =>
      finish(
        new Error(
          'The connection was interrupted. Check your connection, then retry the same photo to check whether it saved.',
        ),
      );
    xhr.onabort = cancel;
    try {
      xhr.open('PUT', path);
      new Headers(headers).forEach((value, name) =>
        xhr.setRequestHeader(name, value),
      );
      onProgress(0);
      xhr.send(body);
    } catch (error) {
      finish(
        error instanceof Error
          ? error
          : new Error('Could not start the upload. Please try again.'),
      );
    }
  });
}
