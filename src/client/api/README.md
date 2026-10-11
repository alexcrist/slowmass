# API client

Same-origin fetch wrapper for JSON responses and safe server error messages. Session cookies are managed by the browser. Request cancellation is passed through standard fetch options; this module stores no credentials or private response cache.

`useApiResource` manages component-scoped GET requests for lists and detail screens. Initial reads, URL changes, and retries expose loading with no old result or read error. Each request has a distinct identity, so returning to a previous URL still starts a fresh read; cancellation and identity checks prevent late responses from replacing the current screen. Consumers show empty states only after a successful result. Mutations remain feature-owned and explicitly reload affected reads. This adds no cache, persistence, polling, or automatic retries.
