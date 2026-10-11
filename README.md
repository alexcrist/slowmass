# slowmass

Slowmass is a private, invitation-only photo-sharing app with a chronological feed and explicit pagination.

## Status

Email-link authentication, invitations with permanent provenance/timestamps, profiles, private avatars, and follow relationships are deployed at https://slowmass.com. First-member email delivery and sign-in are verified.

Single-photo publishing, chronological pagination, post deletion, likes, comments, and in-app notifications are implemented, API-tested, and deployed. Trusted remote image checks verified orientation, metadata removal, and still-image processing. Account deletion, backup/restore exercises, aggregate storage limits, and hosted cost measurements remain beta-readiness work. Production HTTP checks confirm the new private routes reject signed-out access; the complete signed-in multi-user flow is verified in isolated integration tests, not yet against the live site.

The operating target is $0/month within Cloudflare's free allowances, followed by measured upgrades. See [architecture](docs/architecture.md) for constraints and the scaling path.

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

[External setup](docs/setup.md) explains credentials and provisioning. Never paste secrets into issues or commit `.dev.vars`.

## Checks

```sh
npm run check
```

`npm run check` runs formatting, lint, types, unit/Worker integration tests, and the production frontend build. Worker tests run real local D1 and the auth library, including one-time email verification through a simulated email transport. They do not send real emails or prove hosted delivery. Browser and visual testing are prohibited. Multi-user integration tests verify profile/media visibility, follows, blocks, upload retries and cancellation, feed pagination, interaction permissions/counts, notifications, and quotas through the API. No production resources are accessed.

## Project map

- [Agent conventions](CLAUDE.md); `AGENTS.md` is a relative symlink.
- [Product contract](docs/product.md).
- [Architecture and costs](docs/architecture.md).
- [Implementation plan](docs/implementation-plan.md).
- [Visual direction](docs/design.md).
- [Setup and external prerequisites](docs/setup.md).
- [Client](src/client/README.md) and [server](src/server/README.md).

The domain is slowmass.com. The source repository is https://github.com/alexcrist/slowmass. No license has been selected.
