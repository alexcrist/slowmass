# External setup

Status: the production Worker is deployed at https://slowmass.com with D1 and a private R2 bucket. Resend domain verification and first-member sign-in are complete. Use `--env production` for hosted operations; the default configuration remains local-only with a placeholder database ID.

## Cloudflare

From this repository, with Node.js 24 active:

```sh
npx wrangler login
npx wrangler whoami
```

Complete browser authorization using the account that owns slowmass.com. Keep tokens out of chat and source control. The implementation agent can then inspect the account, create the D1 database and private R2 bucket, replace the placeholder binding, and configure the production origin/domain. R2 may require billing activation even within free allowances; complete any account-owner action in Cloudflare's dashboard.

The production Images binding processes private photo bytes. Remote checks verified JPEG orientation and metadata removal, still PNG/WebP conversion, animation rejection, and the complete avatar API using isolated local D1/R2 with remote image processing. The quarter-hour cleanup schedule removes replaced/orphaned avatar and post objects in bounded batches. A direct post API check with real processing also passed against isolated synthetic D1/R2. Hosted CPU measurements and the full deployed multi-user flow remain open. No paid Workers or Images subscription has been enabled. R2 is activated with its usage-based billing and included allowances.

## Email delivery

Create a Resend account on its Free plan. Add slowmass.com as a sending domain and install its verification DNS records in Cloudflare. Keep open and click tracking disabled. Create a sending-only API key scoped to that domain where supported.

In the ignored `.dev.vars` file, enter the API key and your desired sending address. Use `EMAIL_REPLY_TO` for an optional personal reply inbox; Gmail can receive replies but cannot be used as the Resend sender. Set `BOOTSTRAP_EMAIL` to the address you will use for the first account. Its first successful email verification establishes the root member. Once any membership exists, this setting cannot create another root. Every later member requires an active member's invitation.

The implementation agent has generated a local auth secret in `.dev.vars`. On a fresh checkout, copy `.dev.vars.example` and generate one using `openssl rand -base64 32`. Do not paste credentials into chat. Production secrets must be installed through Wrangler's secret input; production needs a distinct auth secret and verified HTTPS origin.

Use the actual sender domain/address verified by Resend. The provider's sandbox sender cannot deliver broadly to friends. The application caps email delivery attempts below the provider's current free daily allowance; provider billing settings remain authoritative. Do not enable automatic paid overages as part of setup.

## Migrations

`npm run db:migrate` applies checked-in migrations to local D1. The auth schema is generated from the installed Better Auth library; membership and email-budget migrations are application-owned. `npm run auth:schema` prints a reference auth schema for review without applying it. Do not replace an applied migration; add forward migrations when the schema changes.

## Next verification gate

After credentials are available, verify a real email link, first-member bootstrap, invited/uninvited joins, logout, private image processing, metadata removal, rejected formats, and deployed Worker CPU consumption. Local simulated email tests do not substitute for hosted delivery or runtime verification. Keep that implementation-plan gate open until observed.

## Provider references

- [Resend sender domain setup](https://resend.com/docs/dashboard/domains/introduction)
- [Resend pricing](https://resend.com/pricing)
- [Better Auth email-link integration](https://better-auth.com/docs/plugins/magic-link)

## Local test isolation

Browser and visual testing are prohibited. Integration tests run isolated Workers/D1/R2 with synthetic accounts and intercept or reject external network requests. They never load `.dev.vars`, send real email, or access production data.

## Production deployment

After a successful `npm run check`, deploy explicitly with `npx wrangler deploy --env production`. Production has a separate auth secret installed through Wrangler, and its only public app origin is https://slowmass.com. Worker preview URLs and workers.dev access are disabled for the app. The account workers.dev subdomain exists only to allow isolated remote-binding development.

Migrations 0001–0011 are applied in production, including posts, interactions, storage accounting, account deletion, shuffled discovery, and mutual inviter follows. Future migrations normally use `npx wrangler d1 migrations apply slowmass --env production --remote`.

### Initial trigger migration workaround

The hosted query endpoint rejected migration 0002 with `incomplete input`, although the unchanged migration passes locally. Its failed transaction left no membership tables. The hosted file-import endpoint successfully applied the original SQL and its migration-history entry atomically. No applied migration was edited.

For a fresh remote database that encounters this same error, first confirm 0002 is absent from `d1_migrations` and membership/invitation tables do not exist. Create a temporary SQL file containing the exact contents of `migrations/0002_membership.sql` followed by `INSERT INTO d1_migrations (name) VALUES ('0002_membership.sql');`. Apply that file with `npx wrangler d1 execute slowmass --env production --remote --file <temporary-file>`, then resume normal migrations. File import temporarily blocks database access and rolls back if it fails; do this during initial provisioning or a maintenance window.

## Latest release verification (October 10, 2026)

Worker version `869ab179-7a11-4f40-816b-cce46d422d0f` deploys photo publishing, feed, likes/comments, and notifications. The local gate passed formatting, lint, TypeScript, 54 unit/integration tests, and production build. Direct production HTTP checks returned 200 for sign-in availability, 401 for signed-out posts/comments/notifications, 404 for inaccessible media, and 403 for a foreign-origin mutation. Private responses use `private, no-store`; deployed frontend assets match the tested build. No browser or visual tests were performed. The full hosted signed-in multi-user flow, CPU measurements, and recovery readiness remain open.

## Operations release (October 10, 2026)

Worker version `d5531cc3-dd03-4666-80de-9b3788e33d15` enables account deletion and storage limits. Migrations 0009/0010 were imported atomically with migration-history records while the app was in maintenance mode; the storage counter and ledger both read zero bytes afterward. Maintenance was then removed. The release passed 59 tests, formatting/lint/types/build, and GitHub CI. Production checks confirmed sign-in availability, anonymous deletion rejection, inaccessible-media rejection, and origin enforcement.

An encrypted production SQL backup was restored and integrity-checked in private local temporary storage; it contains no photos. A synthetic image archive also passed restoration/checksum checks, and tampered ciphertext was rejected. A disposable hosted D1 database passed a bookmark/change/restore/query drill and was deleted afterward. The owner requested a single private recovery ZIP for manual Google Drive upload. See [operations](operations.md) for retention, manual backup cadence, and recovery quarantine.

## Social and navigation release (October 11, 2026)

Worker version `016a77d7-1165-49a1-be95-e2eb5e5393f9` separates profiles and Settings, fixes accumulated page content, adds photo grids and member discovery, and updates invitations, login help, and feed interactions. Magic links remain the sign-in method. Migration 0011 and its history record were imported atomically during maintenance; the discovery index and both profile triggers were verified before reopening the app.

The local check passed formatting, lint, types, 79 tests, and production build; local migrations also passed. A Node component regression test exercises repeated navigation without a browser. Direct production checks verified sign-in availability, anonymous access rejection for new endpoints and media, cross-origin mutation rejection, private response cache headers, and matching deployed HTML/JS/CSS. Authenticated social scenarios are covered in the local Workers/D1 tests; this release did not perform a signed-in multi-user production test or any browser/visual testing.

The pre-migration encrypted production backup passed local quarantined restoration with SQL integrity and both stored image checksums verified. Production was not restored. The initial recovery kit was previously copied off-device by the owner; subsequent backup creation/copying remains manual.

## White interface release (October 11, 2026)

Worker version `67f6dcad-f3c3-407b-be28-ba852ac1d06f` deploys the white canvas, neutral photo surrounds, desktop expanding sidebar, and mobile header/bottom navigation. Browser and manifest theme/background colors are white; primary buttons retain Douglas Fir. There are no database or backend behavior changes.

Formatting, lint, types, 79 existing tests, and production build passed. Direct HTTP checks confirmed the deployed HTML, CSS, JS, and manifest match the checked build and sign-in remains available. Verification used source review and CLI/component/API checks only; no browser or visual tests were performed.

## Interface cleanup release (October 11, 2026)

Worker version `e750a8ca-eac0-439c-9856-1ace8b38be40` places Settings on the member's own profile, removes its global navigation links and the manual Shuffle people control, updates invitation wording, and labels composition “New post.” HTML response headers prevent Cloudflare's injected analytics script from conflicting with the existing self-only CSP; the standard mobile web-app metadata tag is also present.

Formatting, lint, types, 79 tests, and production build passed. Direct HTTP verified exact deployed HTML/JS/CSS matches, no injected analytics script in app or branding HTML, gzip-compressed JS/CSS, available sign-in, and private/no-store responses for anonymous API/media requests. No schema changes, browser tests, or visual tests were needed.
