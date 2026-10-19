import { vi } from 'vitest';

// Mock only the browser transport; component tests still run the real API client.
export function mockUploads(
  send: (path: string, options: RequestInit) => Promise<Response> = () =>
    new Promise(() => {}),
) {
  const requests: Upload[] = [];
  class Upload {
    upload: {
      onprogress:
        | ((event: {
            loaded: number;
            total: number;
            lengthComputable: boolean;
          }) => void)
        | null;
      onload: (() => void) | null;
    } = { onprogress: null, onload: null };
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    status = 0;
    responseText = '';
    headers: Record<string, string> = {};
    path = '';
    method = '';
    body: Blob | undefined;
    controller = new AbortController();
    constructor() {
      requests.push(this);
    }
    open(method: string, path: string) {
      this.method = method;
      this.path = path;
    }
    setRequestHeader(name: string, value: string) {
      this.headers[name] = value;
    }
    send(body: Blob) {
      this.body = body;
      void send(this.path, {
        method: this.method,
        headers: this.headers,
        body,
        signal: this.controller.signal,
      }).then(
        async (response) => {
          this.status = response.status;
          this.responseText = await response.text();
          this.onload?.();
        },
        () => this.onerror?.(),
      );
    }
    abort() {
      this.controller.abort();
      this.onabort?.();
    }
    progress(loaded: number, total = 100, lengthComputable = true) {
      this.upload.onprogress?.({ loaded, total, lengthComputable });
    }
    sent() {
      this.upload.onload?.();
    }
  }
  vi.stubGlobal('XMLHttpRequest', Upload);
  return requests;
}
