# Private avatars

Only an active member with a profile can upload or remove their avatar. Uploads reserve an actor-scoped idempotency key and bounded processing attempt before reading bytes. Successful retries acknowledge the original operation without another transformation; failed/in-progress keys cannot be reused to bypass quotas. Choose the file again to start a new attempt after a confirmed processing failure.

The trusted photo processor creates a WebP variant, at most 320px on either axis. Originals are never stored. R2 writes have durable cleanup intent before upload; a database batch switches the current avatar, queues the previous object for deletion, and marks the attempt complete. The scheduled handler deletes up to two due unreferenced objects and retries failed deletions later. New orphan objects receive a one-hour grace period.

Every media request checks active membership and both block directions. Avatars are visible to signed-in, unblocked members before a follow is accepted. URLs identify a handle rather than an object key; removal/replacement immediately prevents access to the prior object. Responses are private and no-store. There are no public R2 URLs.

Initial limits: five attempts per member per rolling day, 150 across the app per rolling day, and 3,500 per UTC calendar month, shared with post uploads. Failed attempts count. These leave room below the Images free allowance; other services or direct account use still count toward provider limits. Attempt records expire after 60 days, bounding idempotency retention. Body, format, pixel, and output limits live in the photo processor.
