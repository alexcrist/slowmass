# External setup

Status: the production Worker is deployed at https://slowmass.com with D1 and a private R2 bucket. Resend domain verification and first-member sign-in are complete. Use `--env production` for hosted operations; the default configuration remains local-only with a placeholder database ID.

## Cloudflare

From this repository, with Node.js 24 active:

```sh
npx wrangler login
npx wrangler whoami
```

Complete browser authorization using the account that owns slowmass.com. Keep tokens out of chat and source control. The implementation agent can then inspect the account, create the D1 database and private R2 bucket, replace the placeholder binding, and configure the production origin/domain. R2 may require billing activation even within free allowances; complete any account-owner action in Cloudflare's dashboard.

The production Images binding is not configured yet. An isolated remote preview successfully inspected a synthetic PNG and re-encoded it to WebP using private bytes on this account. Full photo safety and quota verification remains open. No paid Workers or Images subscription has been enabled. R2 is activated with its usage-based billing and included allowances.

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

Browser tests start their own local Worker with an explicit, empty `tests/browser/worker.env`. They do not reuse a developer server or load `.dev.vars`. Integration tests intercept email delivery in memory. Neither suite should send real email.

## Production deployment

After a successful `npm run check`, deploy explicitly with `npx wrangler deploy --env production`. Production has a separate auth secret installed through Wrangler, and its only public app origin is https://slowmass.com. Worker preview URLs and workers.dev access are disabled for the app. The account workers.dev subdomain exists only to allow isolated remote-binding development.

All four initial migrations have been applied. Future migrations normally use `npx wrangler d1 migrations apply slowmass --env production --remote`.

### Initial trigger migration workaround

The hosted query endpoint rejected migration 0002 with `incomplete input`, although the unchanged migration passes locally. Its failed transaction left no membership tables. The hosted file-import endpoint successfully applied the original SQL and its migration-history entry atomically. No applied migration was edited.

For a fresh remote database that encounters this same error, first confirm 0002 is absent from `d1_migrations` and membership/invitation tables do not exist. Create a temporary SQL file containing the exact contents of `migrations/0002_membership.sql` followed by `INSERT INTO d1_migrations (name) VALUES ('0002_membership.sql');`. Apply that file with `npx wrangler d1 execute slowmass --env production --remote --file <temporary-file>`, then resume normal migrations. File import temporarily blocks database access and rolls back if it fails; do this during initial provisioning or a maintenance window.
