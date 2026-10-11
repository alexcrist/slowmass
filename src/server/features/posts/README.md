# Posts and feed

Publishing uses an actor-owned draft followed by a bounded binary upload. The client-generated UUID identifies the operation across retries. Drafts reserve shared photo-processing quota; changed draft details require a new operation. A conditional claim allows only one processing request. Trusted processing creates one WebP image, at most 1600px on either axis. Originals are discarded. A durable cleanup entry precedes the R2 write; a database batch publishes only after storage succeeds. Processing failures remain unpublished. Deletion during processing prevents later publication.

One stored variant initially avoids thumbnail transformations and storage duplication. Browser image loading is lazy, but page loading is always explicit. Image bytes are served through authenticated, no-store routes with current block/follow checks.

The home feed excludes own posts and includes only currently accepted follows. Profile posts require owner/follower access. Pages contain at most 12 posts in descending publication time and ID order. A monotonic database publication clock plus snapshot cursor excludes later publications while navigating Older/Newer. Current deletion, blocks, and follow revocation always override the snapshot. Cursor content is validated input, not an authorization grant.

Deleting a post immediately clears public state and content, preserves its identity to prevent replay, and queues object deletion. The scheduled handler processes up to five due post objects per invocation; failed deletions remain queued. Drafts abandoned for an hour become failed. Cleanup shares a quarter-hour schedule with avatars. Provider CPU, aggregate stored-byte limits, backups, and restore verification remain beta-readiness tasks.
