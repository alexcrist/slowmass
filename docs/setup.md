# External setup

Status: the production Worker is deployed at https://slowmass.com with D1 and a private R2 bucket. Resend domain verification and first-member sign-in are complete. Use `--env production` for hosted operations; the default configuration remains local-only with a placeholder database ID.

## Cloudflare

Production fetch execution uses a Washington-region placement hint in Wrangler. After deployment, verify the `cf-placement` response header and compare `Server-Timing` on database-backed routes. Cloudflare selects the data center dynamically near the hint; this is not a Seattle residency guarantee. D1 and R2 retain their separate storage locations. See the [placement measurements](operations.md#washington-placement-measurements--october-12-2026) for evidence and rollback.

From this repository, with Node.js 24 active:

```sh
npx wrangler login
npx wrangler whoami
```

Complete browser authorization using the account that owns slowmass.com. Keep tokens out of chat and source control. The implementation agent can then inspect the account, create the D1 database and private R2 bucket, replace the placeholder binding, and configure the production origin/domain. R2 may require billing activation even within free allowances; complete any account-owner action in Cloudflare's dashboard.

Production HTTPS enforcement is configured in Cloudflare under **SSL/TLS → Edge Certificates**, outside Wrangler: **Always Use HTTPS** is on, and **HSTS** is enabled for six months (`max-age=15552000`), with **Include subdomains** and **Preload** off. HTTP requests redirect to the same HTTPS path and query; HTTPS responses include HSTS for static assets, API responses, and media errors. These settings persist across app deployments. Verify redirects and headers with direct HTTP requests after changing domain or TLS configuration. Keep HTTPS available while browsers retain the HSTS policy.

The production Images binding processes private photo bytes. Remote checks verified JPEG orientation and metadata removal, still PNG/WebP conversion, animation rejection, and the complete avatar API using isolated local D1/R2 with remote image processing. The quarter-hour cleanup schedule removes replaced/orphaned avatar and post objects in bounded batches. A direct post API check with real processing also passed against isolated synthetic D1/R2. Hosted CPU measurements and the full deployed multi-user flow remain open. No paid Workers or Images subscription has been enabled. R2 is activated with its usage-based billing and included allowances.

## Email delivery

Create a Resend account on its Free plan. Add slowmass.com as a sending domain and install its verification DNS records in Cloudflare. Keep open and click tracking disabled. Create a sending-only API key scoped to that domain where supported.

In the ignored `.dev.vars` file, enter the API key and your desired sending address. Use `EMAIL_REPLY_TO` for an optional personal reply inbox; Gmail can receive replies but cannot be used as the Resend sender. Set `BOOTSTRAP_EMAIL` to the address you will use for the first account. Its first successful email verification establishes the root member. Once any membership exists, this setting cannot create another root. Every later member requires an active member's invitation.

The implementation agent has generated a local auth secret in `.dev.vars`. On a fresh checkout, copy `.dev.vars.example` and generate one using `openssl rand -base64 32`. Do not paste credentials into chat. Production secrets must be installed through Wrangler's secret input; production needs a distinct auth secret and verified HTTPS origin.

Use the actual sender domain/address verified by Resend. The provider's sandbox sender cannot deliver broadly to friends. The application caps email delivery attempts below the provider's current free daily allowance; provider billing settings remain authoritative. Do not enable automatic paid overages as part of setup.

## Migrations

`npm run db:migrate` applies checked-in migrations to local D1. The auth schema is generated from the installed Better Auth library; membership and email-budget migrations are application-owned. `npm run auth:schema` prints a reference auth schema for review without applying it. Do not replace an applied migration; add forward migrations when the schema changes.

## Next verification gate

First-member email delivery/sign-in and trusted image processing have been verified. Complete hosted invited/uninvited joining, session expiry/logout, the signed-in multi-user flow, and Worker CPU measurements. Local simulated email tests do not substitute for hosted delivery or runtime verification. Keep that implementation-plan gate open until observed.

## Provider references

- [Resend sender domain setup](https://resend.com/docs/dashboard/domains/introduction)
- [Resend pricing](https://resend.com/pricing)
- [Better Auth email-link integration](https://better-auth.com/docs/plugins/magic-link)

## Local test isolation

Browser and visual testing are prohibited. Integration tests run isolated Workers/D1/R2 with synthetic accounts and intercept or reject external network requests. They never load `.dev.vars`, send real email, or access production data.

## Production deployment

Use [GitHub Actions](https://github.com/alexcrist/slowmass/actions/workflows/ci.yml) and Git history for deployment records. Keep this guide about setup and operating procedures; routine deployments do not need documentation updates.

The GitHub Actions `Checks` workflow deploys pushes to `main` after formatting, lint, types, boundary/unit/integration tests, the frontend build, and local migrations succeed. Pull requests and other branches only run checks. The production job downloads the exact frontend build from the check job, installs locked dependencies, checks migration policy, applies routine production migrations, verifies the resulting history, and deploys through the repository's Wrangler version. Deployments are serialized without interrupting an active release; a queued commit is skipped if it is no longer the current `main` commit. A newer push during deployment is handled by the next successful run.

GitHub requires the repository variable `CLOUDFLARE_ACCOUNT_ID` and Actions secret `CLOUDFLARE_API_TOKEN`. The `production` environment restricts deployments to the `main` branch. Create a dedicated token scoped to the owning account with Workers Scripts Write, Account Settings Read, D1 Write and Workers R2 Storage Read, plus Workers Routes Write scoped to slowmass.com. Keep the token in GitHub's encrypted secret storage, never source or logs; do not upload a personal Wrangler OAuth session. See [Cloudflare's CI authentication guidance](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/).

Each SQL filename must be classified as `automatic` or `manual` in `migrations/deployment-policy.json`; isolated tests enforce complete, valid coverage. The preflight reads `d1_migrations` and stops on pending manual migrations, unknown applied migrations, missing credentials, or invalid provider output before applying any migration. The job records the current D1 Time Travel bookmark, runs `wrangler d1 migrations apply` against production, then requires history to match before deploying the Worker. Routine automatic migrations must preserve existing data and remain compatible with the previous Worker, including after partial migration success or a failed deployment. Breaking/destructive changes and large backfills stay manual under the backup/maintenance runbook. See [migration authoring](../migrations/README.md). Before maintenance, recovery, or a manual rollback, set the repository variable `AUTO_DEPLOY_DISABLED=true`, then let any running deployment finish and cancel pending releases. Clear the variable after resolving the incident and rerun the latest compatible `main` release. This switch leaves checks enabled. Never manually deploy concurrently with the production job.

After publishing, direct HTTP checks compare deployed HTML, linked JS/CSS, manifest and startup bytes with the checked build, verify sign-in availability, and check signed-out API/media rejection and no-store headers. They retry briefly for propagation. A failed check marks the job failed but does not automatically roll back code or data; inspect the published release and follow the operations runbook. These probes do not verify signed-in member flows or real-device behavior.

For an explicit operator deployment, pause automatic deployments as above, run `npm run check`, and use `npx wrangler deploy --env production`. Production has a separate auth secret installed through Wrangler, and its only public app origin is https://slowmass.com. Worker preview URLs and workers.dev access are disabled for the app. The account workers.dev subdomain exists only to allow isolated remote-binding development.

The workflow uses `npx wrangler d1 migrations apply slowmass --env production --remote`; operators use the same command for manual migrations after following the runbook. A migration failure prevents deployment. Earlier successful migrations remain applied, and retries resume from history. A deployment failure leaves the expanded schema in place. See [Wrangler migration failure semantics](https://developers.cloudflare.com/workers/wrangler/commands/d1/#d1-migrations-apply).

### Initial trigger migration workaround

The hosted query endpoint rejected migration 0002 with `incomplete input`, although the unchanged migration passes locally. Its failed transaction left no membership tables. The hosted file-import endpoint successfully applied the original SQL and its migration-history entry atomically. No applied migration was edited.

For a fresh remote database that encounters this same error, first confirm 0002 is absent from `d1_migrations` and membership/invitation tables do not exist. Create a temporary SQL file containing the exact contents of `migrations/0002_membership.sql` followed by `INSERT INTO d1_migrations (name) VALUES ('0002_membership.sql');`. Apply that file with `npx wrangler d1 execute slowmass --env production --remote --file <temporary-file>`, then resume normal migrations. File import temporarily blocks database access and rolls back if it fails; do this during initial provisioning or a maintenance window.

## Web Push setup

Follow the migration policy and backup runbook when provisioning Web Push. Subscriptions require explicit opt-in and do not replay historical activity. Stable P-256 VAPID keys are required in both `PUSH_PUBLIC_KEY` and `PUSH_PRIVATE_KEY` Worker secrets. Generate them once outside the repository, keep a private recovery copy, and never rotate them incidentally during deployment:

```sh
node scripts/ops/push-keys.mjs /private/path/push-vapid.json
npx wrangler secret bulk /private/path/push-vapid.json --env production
```

The script refuses to overwrite an existing file. For local experiments use separate test keys in `.dev.vars`; production keys must never be used in CI. The public half is intentionally exposed to authenticated browser subscribers; the private half never enters the client. The application origin identifies the VAPID sender. No additional provider account or paid service is needed. Losing/rotating this pair requires removing existing subscriptions and having members opt in again; the encrypted D1 backup does not contain the VAPID private key.

The existing Worker uses an hourly delivery cron alongside quarter-hour maintenance. Deploy only after the full repository gate passes. Settings remains off by default, with explicit enable/disable per signed-in device. iOS/iPadOS requires a Home Screen web app and a user-initiated permission request ([WebKit](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)). Permission or OS settings may prevent delivery; local tests cannot prove device receipt. See the [push README](../src/server/features/push/README.md) for hourly fallback delays and backlog limits.
