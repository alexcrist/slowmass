# Operations tools

Run from the repository root with Node 24 and authenticated Wrangler. No browser automation is used. `backup.mjs <new-archive> <key-file>` exports production D1 and every referenced published photo/avatar, records checksums, and streams an AES-256-GCM encrypted archive. Generate a 32-byte random key outside the repository and protect it with mode 600. A missing object or provider error fails the backup rather than producing a success claim. Plaintext intermediate files are private and removed on exit. Backup creation is read-only against production.

`restore-check.mjs <archive> <key-file>` authenticates/decrypts, checks SQL integrity and foreign keys, verifies each photo checksum, and exercises quarantine by clearing sessions/tokens and disabling active memberships. It uses temporary local storage, removes it afterward, and cannot write to production. The synthetic CI exercise includes a real image fixture and rejects tampered ciphertext. This verifies recoverability of the snapshot, not application serving from a restored Cloudflare environment.

`usage.mjs` reads Cloudflare's aggregate Worker, D1, and R2 metrics for the preceding day. It refreshes Wrangler OAuth through a read-only command, or uses `CLOUDFLARE_API_TOKEN`. Tokens and user content are never printed. `SLOWMASS_WRANGLER_AUTH_FILE` overrides the platform-default credential file location. No paid monitoring service, polling worker, public admin endpoint, or scheduled local job is provisioned.

See [operations](../../docs/operations.md) for retention, recovery sequencing, and cost thresholds. These tools do not automatically schedule backups or manage off-device copies.
