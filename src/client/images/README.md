# Local image decoding

Avatar and post cropping share type checks and orientation-aware bitmap decoding. Local originals may be JPEG, PNG, or WebP up to 32 MiB and 40 megapixels. The source-byte limit is deliberately larger than the server’s 8 MiB upload limit: rejecting originals at that limit would prevent local resizing from running. The pixel ceiling still bounds accepted decoded images; it is checked after decoding, so unusually large dimensions can exhaust device memory before validation.

Both crop editors encode the selected original pixels at up to a 1600px long edge, without upscaling, requesting WebP quality 0.92. They validate the actual encoder output (including a browser’s supported-format fallback) against the 8 MiB upload limit before allowing upload. The server independently validates and re-encodes those bytes; client checks are only for usability. No additional compression pass is needed for larger originals.

Callers own bitmap lifetime, close it on replacement/unmount, and ignore late decodes. Files and previews remain in memory. Oversized, unsupported, or undecodable sources show a recoverable error; the original is never uploaded as a fallback.

Decoding and crop encoding each have a 30-second deadline. A decoder result arriving after expiry is closed, and an expired encoder result is ignored. These deadlines release pending UI when the event loop can run; they cannot preempt a synchronous browser freeze or prevent the decoded-memory limit described above. Both crop editors use the same bounded encoder.

`PhotoProgress` supplies the shared phase/status copy for crop editors and all three upload forms. It shows a byte percentage only while the browser reports sending the photo. After the body is sent, processing and saving remain one unmeasured phase until the server confirms success; there is no invented processing percentage. After 15 seconds in a phase, a polite status explains the longer wait. Progress uses neutral styling and phase announcements rather than repeated screen-reader percentage announcements.
