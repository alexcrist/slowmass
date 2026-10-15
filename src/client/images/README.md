# Local image decoding

Avatar and post cropping share type checks and orientation-aware bitmap decoding. Local originals may be JPEG, PNG, or WebP up to 32 MiB and 40 megapixels. The source-byte limit is deliberately larger than the server’s 8 MiB upload limit: rejecting originals at that limit would prevent local resizing from running. The pixel ceiling still bounds accepted decoded images; it is checked after decoding, so unusually large dimensions can exhaust device memory before validation.

Both crop editors encode the selected original pixels at up to a 1600px long edge, without upscaling, requesting WebP quality 0.92. They validate the actual encoder output (including a browser’s supported-format fallback) against the 8 MiB upload limit before allowing upload. The server independently validates and re-encodes those bytes; client checks are only for usability. No additional compression pass is needed for larger originals.

Callers own bitmap lifetime, close it on replacement/unmount, and ignore late decodes. Files and previews remain in memory. Oversized, unsupported, or undecodable sources show a recoverable error; the original is never uploaded as a fallback.
