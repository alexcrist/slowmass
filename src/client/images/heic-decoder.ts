import createLibheif from 'libheif-js/libheif/libheif.js';

// The package types cover only the low-level bindings; this is the small part
// of its JavaScript decoder API used here.
type HeifImage = {
  get_width(): number;
  get_height(): number;
  is_primary(): boolean;
  free(): void;
  display(
    target: { data: Uint8ClampedArray; width: number; height: number },
    done: (result: unknown) => void,
  ): void;
};
type Libheif = {
  HeifDecoder: new () => {
    decoder: unknown;
    decode(bytes: Uint8Array): HeifImage[];
  };
  heif_context_free(context: unknown): void;
};

let libheif: Libheif | undefined;

// Decodes the primary still image to RGBA with its stored rotation applied.
export async function decodeHeic(bytes: Uint8Array) {
  libheif ??= createLibheif() as unknown as Libheif;
  const decoder = new libheif.HeifDecoder();
  let images: HeifImage[] = [];
  try {
    images = decoder.decode(bytes);
    // Other top-level images, such as unhidden grid tiles, can come first.
    const image = images.find((item) => item.is_primary()) ?? images[0];
    if (!image) throw new Error('No HEIC image found');
    const width = image.get_width();
    const height = image.get_height();
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width < 1 ||
      height < 1
    )
      throw new Error('Invalid HEIC dimensions');
    const data = new Uint8ClampedArray(width * height * 4);
    // The decoder leaves alpha untouched for opaque images.
    for (let offset = 3; offset < data.length; offset += 4) data[offset] = 255;
    await new Promise<void>((resolve, reject) =>
      image.display({ data, width, height }, (result) =>
        result ? resolve() : reject(new Error('HEIC decoding failed')),
      ),
    );
    return { width, height, data };
  } finally {
    for (const image of images) image.free();
    if (decoder.decoder) libheif.heif_context_free(decoder.decoder);
  }
}
