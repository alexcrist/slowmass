# API client

Same-origin fetch wrapper for JSON responses and safe server error messages. Session cookies are managed by the browser. Request cancellation is passed through standard fetch options; this module stores no credentials or private response cache.

`useApiResource` manages component-scoped GET requests for lists and detail screens. Initial reads, URL changes, and retries expose loading with no old result or read error. Each request has a distinct identity, so returning to a previous URL still starts a fresh read; cancellation and identity checks prevent late responses from replacing the current screen. Consumers show empty states only after a successful result. Mutations remain feature-owned and explicitly reload affected reads. This adds no cache, persistence, polling, or automatic retries.

HTTP failures preserve their status in `ApiError`. A mounted session subscribes to unauthorized responses before its screens start requests. The first non-aborted 401 notifies that session once; subscription identity prevents late responses from an old session from invalidating a new sign-in. Server failures such as 503 remain ordinary retryable errors. The API module owns this transport signal; Welcome owns the sign-in transition. No private drafts or credentials are persisted during recovery.

List/detail GET reads have a fifteen-second deadline including response-body decoding. Expiry aborts the request and exposes the consumer's Retry action; late responses cannot replace the current result. Unmount/navigation clears the timer and aborts the old read. This does not replay mutations or clear a valid session.
