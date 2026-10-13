# slowmass

Slowmass is a private, invitation-only photo-sharing app with a chronological feed of your own posts and accepted follows, with explicit pagination.

## Status

Email-link authentication, invitations with permanent provenance/timestamps, profiles, private avatars, and follow relationships are deployed at https://slowmass.com. First-member email delivery and sign-in are verified.

Direct invitation joining is deployed: one invitation email opens a confirmation page, then signs the recipient in for profile setup without another email. The per-member daily invitation cap is removed; shared email-delivery budgets still apply. Production has migrations 0001–0025. Profiles you follow now include paginated Following and Followers tabs. On desktop, tapping a focused post photo opens a larger image viewer; full-width mobile photos remain unchanged. See the [latest release verification](docs/setup.md#onboarding-recovery-audit-and-copy-release-october-12-2026).

Single-photo publishing, chronological pagination, post deletion, likes, comments, and in-app notifications are implemented, API-tested, and deployed. Optional per-device Web Push is available in Settings and shares Activity identities and read state. A member reported successful Android opt-in after retry; actual OS delivery still needs confirmation. Trusted remote image checks verified orientation, metadata removal, and still-image processing. Account deletion, aggregate/per-member storage limits, encrypted backup/restore tooling, and hosted usage reporting are implemented. Backups are manual; keep a verified off-device copy. See the [operations runbook](docs/operations.md) for recovery limits and measured usage. Production HTTP checks confirm the new private routes reject signed-out access; the complete signed-in multi-user flow is verified in isolated integration tests, not yet against the live site.

New-follower Activity/push is deployed, including invitation follows once photo setup completes. Better Auth schema inspection now runs explicitly in CI rather than during serving requests. This mitigates a reproduced library stall; the reported Android opt-in failure recovered on retry and its precise production cause remains unconfirmed.

The operating target is $0/month within Cloudflare's free allowances, followed by measured upgrades. See [architecture](docs/architecture.md) for constraints and the scaling path.

One current invite link per member is deployed with seven-day expiry and no sign-up cap. Copy reuses a valid link or creates a fresh one after expiry; Replace link lives in an overflow menu with confirmation. Link history and per-link joiner panels are removed. Migration 0025 is applied locally and in production. Joined-invitee Activity remains available for both invitation types.

## Local development

Use Node.js 24 (`nvm use` if using nvm) and npm.

```sh
npm ci
npm run build
npm run db:migrate
cp .dev.vars.example .dev.vars
npm run dev
```

Open http://localhost:8787. The welcome screen works without credentials and reports that sign-in is unavailable. For frontend hot reload, also run `npm run dev:ui`; its API proxy requires the Worker to be running. Test actual email links on port 8787, the configured origin.

Default local development uses isolated D1/R2 storage and the local Images emulator, including profile-photo cropping and uploads. It does not use production data or remote image processing. The emulator supports the basic transforms used here; hosted processing behavior is verified separately.

[External setup](docs/setup.md) explains credentials and provisioning. Never paste secrets into issues or commit `.dev.vars`.

## Checks

```sh
npm run check
```

`npm run check` runs formatting, lint, types, unit/Worker integration tests, and the production frontend build. Worker tests run real local D1 and the auth library, including one-time email verification through a simulated email transport. They do not send real emails or prove hosted delivery. Browser and visual testing are prohibited. Multi-user integration tests verify profile/media visibility, follows, blocks, upload retries and cancellation, feed pagination, interaction permissions/counts, notifications, and quotas through the API. No production resources are accessed.

## Project map

- [Agent conventions](CLAUDE.md); `AGENTS.md` is a relative symlink.
- [Product contract](docs/product.md).
- [Feature wishlist](docs/feature-wishlist.md).
- [Architecture and costs](docs/architecture.md).
- [Implementation plan](docs/implementation-plan.md).
- [Visual direction](docs/design.md).
- [Setup and external prerequisites](docs/setup.md).
- [Client](src/client/README.md) and [server](src/server/README.md).

The domain is slowmass.com. The source repository is https://github.com/alexcrist/slowmass. No license has been selected.
