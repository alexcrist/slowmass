# External setup

Status: the production Worker is deployed at https://slowmass.com with D1 and a private R2 bucket. SES domain verification and first-member sign-in are complete. Use `--env production` for hosted operations; the default configuration remains local-only with a placeholder database ID.

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

## Google sign-in preparation

Google provider registration, the backend integration, identity migration, and email-first sign-in controls are deployed. Direct HTTP checks verify provider availability and Google authorization initiation; completion with a real Google account remains to be verified. The Google Cloud project is `slowmass`, and ownership of `slowmass.com` is verified in Google Search Console through a Cloudflare TXT record. Keep that verification record in DNS. The OAuth application is External and In production. Google approved its branding, and the verified branding is published.

The web clients are `slowmass production` and `slowmass development`. Their authorized origins are `https://slowmass.com` and `http://localhost:8787`, with matching `/api/auth/callback/google` redirect URLs. Authorization requests include only OpenID and email scopes; Google profile access is not requested. Production `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are installed as Worker secrets; the separate development credentials are in ignored `.dev.vars`. Private recovery copies are stored outside the repository in `~/.config/slowmass/google-oauth/`, with owner-only file permissions. The deployed backend consumes these credentials.

The registered app name is lowercase `slowmass`, with `https://slowmass.com` as its homepage and the existing `public/icons/app-512.png` uploaded as its logo. The public privacy page and homepage description/link are live. The privacy URL is registered as `https://slowmass.com/privacy/`. Google completed branding verification and the approved branding is published; no sensitive or restricted scope review is required.

The [auth backend](../src/server/auth/README.md) integrates Google with existing accounts, shared email matching, and both invitation paths; sign-in controls are deployed for normal, member-invite, and event-invite entry. They appear only when bootstrap reports Google configured. A read-only production audit on October 21, 2026 found zero email-alias collision groups and zero duplicate provider identities. It read no personal values into its output and changed no data. Repeat the audit before rollout:

```sh
npm run auth:audit -- --remote
```

The command prints aggregate counts and fails on collisions. Its default without `--remote` audits local D1. Never merge existing accounts automatically. Migration 0036 is manual: follow the backup/maintenance runbook, rerun the audit, apply the reviewed migration explicitly, and deploy the matching code before admitting new sign-ins. This constraint prevents duplicate aliases and provider bindings under concurrent callbacks. Migration 0036 and the matching backend are deployed; the pre-migration audit and encrypted backup/restore checks passed. Keep OAuth client secrets outside source control.

The signed-out homepage includes a small description and Privacy link at the bottom, also present in its pre-JavaScript HTML. The standalone `public/privacy/index.html` page serves at `/privacy/` without authentication or JavaScript. Its plain-language notice covers data use, Google identity, providers, sharing, deletion, retention, and the operator contact, with explicit promises that members own their content, data use is limited to operating the app, and data is never sold/rented, shared with advertisers/data brokers, or fed to AI. Keep its claims aligned with actual app and operational behavior, including manual backup cleanup. Google Auth Platform → Branding already uses `https://slowmass.com/privacy/`. Branding approval does not prove hosted authentication: complete real-account login verification in addition to the deployed controls and HTTP checks.

## Email delivery

Sign-in mail is sent through Amazon SES; see [Amazon SES](#amazon-ses) for the provisioned account. In the ignored `.dev.vars` file, enter the SES sending user's access key and your desired sending address. The IAM policy only permits `hello@slowmass.com`, so local development sends real email from the same identity; other sender addresses fail with `AccessDeniedException`. Use `EMAIL_REPLY_TO` for an optional personal reply inbox. Set `BOOTSTRAP_EMAIL` to the address you will use for the first account. Its first successful email verification establishes the root member. Once any membership exists, this setting cannot create another root. Every later member requires an active member's invitation.

The implementation agent has generated a local auth secret in `.dev.vars`. On a fresh checkout, copy `.dev.vars.example` and generate one using `openssl rand -base64 32`. Do not paste credentials into chat. Production secrets must be installed through Wrangler's secret input; production needs a distinct auth secret and verified HTTPS origin.

### Amazon SES

SES sends from `us-west-2`. The `slowmass.com` identity is verified with 2048-bit Easy DKIM, its three DNS-only CNAME records are published in Cloudflare, and the domain has a DMARC `p=none` policy. Production access was granted on October 24, 2026 (support case 179246744200507) with a 50,000-message daily quota and 14 messages per second. Approval and quotas apply to this region only. The AWS account also hosts unrelated projects; slowmass resources are tagged `project=slowmass`.

The account uses à-la-carte pricing (`CurrentPlan: NONE`). As of October 2026, the base sending price is $0.10 per 1,000 recipients, plus applicable data and notification charges; this is usage-based billing, not an unlimited free allowance. No dedicated IPs, receiving service, or monthly subscription is needed. See [SES pricing](https://aws.amazon.com/ses/pricing/).

The Worker authenticates as IAM user `slowmass-ses-sender`, whose only inline policy allows `ses:SendEmail` on the `slowmass.com` identity when the From address is `hello@slowmass.com`. Its access key is stored only in the production Worker secrets `SES_ACCESS_KEY_ID`/`SES_SECRET_ACCESS_KEY` and the operator's ignored `.dev.vars`. To rotate it, create a second key, install both secrets with `wrangler secret put --env production`, update `.dev.vars`, then deactivate and delete the old key.

**Spending cap.** AWS Budget `slowmass-ses-monthly-cap` covers only the Amazon Simple Email Service charge category at $100 per month. It emails the operator's personal Gmail when actual SES charges exceed 10% and 50% and when the forecast exceeds 100%. At 100% of actual charges, an automatic budget action attaches the managed policy `slowmass-ses-spending-cap-deny` (deny `ses:*`) to the sending user through role `slowmass-budget-actions`, which may only attach or detach that one policy on that one user. Sign-in email then fails until AWS resets IAM budget actions at the start of the next monthly period. Cost data refreshes several times a day, so charges can overshoot before the action runs; SES's daily quota bounds that overshoot to roughly $5 per day. This is not an account-wide AWS spending cap. To restore sending early after investigating, reverse the action:

```sh
aws budgets describe-budget-actions-for-budget --profile slowmass --region us-east-1 \
  --account-id 909719689394 --budget-name slowmass-ses-monthly-cap
aws budgets execute-budget-action --profile slowmass --region us-east-1 \
  --account-id 909719689394 --budget-name slowmass-ses-monthly-cap \
  --action-id <ActionId> --execution-type REVERSE_BUDGET_ACTION
```

Account-level suppression is enabled for both hard bounces and complaints. Both identity notification types publish to the standard SNS topic `slowmass-email-feedback` in the same region. Its policy permits SES publication only from this account and identity, and its confirmed email subscription delivers alerts to the operator's personal Gmail. Original email headers are excluded; feedback metadata still contains recipient addresses and must remain private. Direct feedback forwarding to the sending address is disabled because that address has no inbox. Both permanent-bounce and abuse-complaint simulator notifications have been received through SNS. Simulator bounces do not populate the suppression list, so this verifies the alert path, not a real recipient's suppression. Keep suppression enabled and review feedback alerts; investigate the cause before removing any suppression, and require evidence that the recipient wants mail.

Use the local `slowmass` AWS profile with a current AWS CLI v2. Refresh its temporary session with `aws login --profile slowmass --region us-west-2`; the profile flag matters because the workstation's `AWS_PROFILE` points at another account. Do not create root access keys. On the current workstation, `/opt/homebrew/bin/aws` supports this login while the older `/usr/local/bin/aws` does not. Check the account, suppression settings, and sender verification:

```sh
aws sesv2 get-account --profile slowmass --region us-west-2 \
  --query '{Production:ProductionAccessEnabled,Quota:SendQuota,Suppression:SuppressionAttributes}'
aws sesv2 get-email-identity --profile slowmass --region us-west-2 \
  --email-identity slowmass.com \
  --query '{Verified:VerifiedForSendingStatus,DKIM:DkimAttributes.Status,Forwarding:FeedbackForwardingStatus}'
```

The production-access request copy and support reply remain at `~/.config/slowmass/ses-production-access.json` and `~/.config/slowmass/ses-support-reply.txt`; the reply describes the former 80-attempt daily ceiling, which the application no longer enforces. Optional event email additionally needs consent records, preferences/unsubscribe handling, authorization checks at delivery time, and bounded fan-out that leaves capacity for sign-in mail. None of those controls is implemented.

## Migrations

`npm run db:migrate` applies checked-in migrations to local D1. The auth schema is generated from the installed Better Auth library; membership and email-budget migrations are application-owned. `npm run auth:schema` prints a reference auth schema for review without applying it. Do not replace an applied migration; add forward migrations when the schema changes.

## Next verification gate

First-member email delivery/sign-in and trusted image processing have been verified. Complete hosted invited/uninvited joining, session expiry/logout, the signed-in multi-user flow, and Worker CPU measurements. Local simulated email tests do not substitute for hosted delivery or runtime verification. Keep that implementation-plan gate open until observed.

## Provider references

- [SES pricing](https://aws.amazon.com/ses/pricing/)
- [AWS Budgets actions](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-controls.html)
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
