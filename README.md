# slowmass

Slowmass is a private photo-sharing app with a chronological feed of your own posts and accepted follows, with explicit pagination.

## Status

The app runs at https://slowmass.com. The repository implements email-link sign-in, member and event invitations with permanent provenance, private profiles and avatars, follows, single-photo posts, a paginated feed, likes, comments, Activity, optional Web Push, and events with hosts, guest answers, messages, appearance choices, calendar copies, and creator-only deletion. Members without a profile photo can use events, Activity, Settings, Find, and other members’ profile previews; following, posting, and the feed require completed account setup.

Feature READMEs in the [client](src/client/README.md) and [server](src/server/README.md) describe implemented behavior. The [implementation plan](docs/implementation-plan.md) tracks remaining work and verification gaps. First-member email delivery, sign-in, and trusted remote image processing have been verified; a complete hosted multi-user flow and real-device calendar/push behavior still need confirmation.

Account deletion, storage limits, encrypted backup/restore tooling, and usage reporting are implemented. Backups remain manual; keep a verified off-device copy and follow the [operations runbook](docs/operations.md). The operating target is $0/month within free allowances, followed by measured upgrades; see [architecture](docs/architecture.md).

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

Pushes to `main` deploy through GitHub Actions after checks and local migrations pass. The production job applies migrations classified as automatic before deploying, blocks pending manual migrations, and verifies deployed assets and signed-out boundaries by HTTP. See [deployment setup](docs/setup.md#production-deployment) for credentials, pausing releases, and explicit migration handling.

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

Optional installation and notifications live in Settings, and phones/tablets get one dismissible device-setup suggestion in Activity. See [device setup](src/client/features/device-setup/README.md); preview with `npm run dev:ui` at `/previews/device-setup.html`.
