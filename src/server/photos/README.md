# Photo processing

Accepts at most 8 MiB of still JPEG, PNG, or WebP bytes and at most 40 megapixels. PNG and WebP container framing is checked for animation before decoding; GIF, SVG, HEIC, and unsupported containers are rejected. Cloudflare Images remains the trusted pixel decoder. A container check alone never makes an original safe to serve.

Output is a bounded WebP image with metadata removed, orientation applied, and aspect ratio preserved. Processing failures never return original bytes. The caller must authenticate, bound the upload stream, reserve quota before processing, and persist only successful output behind authorization. This module does not publish or store images.

Upload transport bounds actual streamed bytes before decoding. Processing-attempt reservations are atomic and actor-scoped; retries cannot bypass limits. This shared module does not decide whether a viewer may read an image. Feature-specific media routes and cleanup own that authorization and object lifecycle.
