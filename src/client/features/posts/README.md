# Posting and feed screens

The composer selects one still image, provides a local object-URL preview, caption and optional alt text, then creates a draft and uploads the photo. Object URLs are revoked when replaced or unmounted. A stable operation ID survives network retries. Cancellation requests draft deletion; uncertain cancellation is reported honestly. Successful publication navigates to My photos.

Feeds and profile posts use explicit Older/Newer controls and preserve cursor history. Refresh starts a new snapshot. Photos load lazily without requesting another page. Deletion requires an inline confirmation. Private content is not persisted to local storage, cached by a service worker, or sent to third-party image hosts. All validation and visibility decisions remain server-authoritative.
