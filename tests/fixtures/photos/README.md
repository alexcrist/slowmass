# Synthetic image fixtures

Generated locally with Pillow 12.3.0: red 120×80 images, a blue second frame for animated PNG/WebP, and JPEG EXIF orientation 6 plus a `PRIVATE_TEST_METADATA` description. They contain no personal photos or location data. Remote processing verified JPEG rotation to 80×120, stripped EXIF/XMP, and animation rejection on October 10, 2026. Unit checks use only the local container fixtures; they do not call Cloudflare.

`large.png` is a synthetic 1200×800 RGB gradient/checker pattern generated with Python's standard-library PNG encoding (zlib and CRC32). It verifies real local full/grid processing and reduced output size; it contains no user photo.
