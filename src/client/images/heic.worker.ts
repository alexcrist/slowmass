import { decodeHeic } from './heic-decoder';

export type HeicResult =
  | { ok: true; width: number; height: number; data: ArrayBuffer }
  | { ok: false };

// One decode per worker; the page terminates it afterwards.
self.onmessage = async (event: MessageEvent<ArrayBuffer>) => {
  let result: HeicResult = { ok: false };
  const transfer: ArrayBuffer[] = [];
  try {
    const image = await decodeHeic(new Uint8Array(event.data));
    const data = image.data.buffer;
    result = { ok: true, width: image.width, height: image.height, data };
    transfer.push(data);
  } catch {
    // Reported as a failed decode.
  }
  self.postMessage(result, { transfer });
};
