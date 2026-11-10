import type { HeicResult } from './heic.worker';

export const isHeic = (file: File) =>
  ['image/heic', 'image/heif'].includes(file.type) ||
  // Browsers without a registered HEIC type report an empty one.
  (!file.type && /\.hei[cf]$/i.test(file.name));

// For browsers that cannot open HEIC themselves. The decoder is a separate,
// large script fetched only when this runs, and it runs off the main thread.
// Aborting stops the worker.
export async function decodeHeicInWorker(
  file: Blob,
  signal: AbortSignal,
): Promise<ImageBitmap> {
  const bytes = await file.arrayBuffer();
  signal.throwIfAborted();
  const worker = new Worker(new URL('./heic.worker.ts', import.meta.url), {
    type: 'module',
  });
  const stop = () => worker.terminate();
  signal.addEventListener('abort', stop, { once: true });
  try {
    const result = await new Promise<HeicResult>((resolve, reject) => {
      worker.onmessage = (event: MessageEvent<HeicResult>) =>
        resolve(event.data);
      worker.onerror = () => reject(new Error('HEIC decoder failed'));
      worker.postMessage(bytes, [bytes]);
    });
    if (!result.ok) throw new Error('HEIC decoding failed');
    return await createImageBitmap(
      new ImageData(
        new Uint8ClampedArray(result.data),
        result.width,
        result.height,
      ),
    );
  } finally {
    signal.removeEventListener('abort', stop);
    stop();
  }
}
