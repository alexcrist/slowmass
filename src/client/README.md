# Client

A static React application served by Workers Assets. [Welcome](features/welcome/README.md) handles email login (including signing in through an invite or event link) and logout, then mounts [member screens](features/people/README.md). These compose [avatars](features/avatars/README.md), [posts](features/posts/README.md), [interactions](features/interactions/README.md), [events](features/events/README.md), [invite links](features/invite-links/README.md), and [notifications](features/notifications/README.md), using the shared [API client](api/README.md).

New members give only a name, then choose a username and profile photo on one setup screen unless they arrived through an event; until they add one they can use events, Activity, Settings, Find, and other members’ profile previews. Following, posting, and the feed remain gated on setup. Installation and notification opt-in are available from Settings; [device setup](features/device-setup/README.md) suggests them once in Activity on phones and tablets.

[Install support](features/install/README.md) adds a standalone web-app manifest, mobile-only install instructions and browser install prompts where available.

[Account deletion](features/account/README.md) is available from Settings.

[Shared UI controls](ui/README.md) provide native dialogs, overflow menus, link copy fields, the mail icon, and relative timestamps. [Local image decoding](images/README.md) is shared by the avatar and post crop editors.

`previews/device-setup.html` is a development-only page served by `npm run dev:ui`; production builds include only `index.html`.

Global styling lives in `styles.css`; events temporarily override its color and font roles using the [shared appearance contract](../shared/event-appearance/README.md), with font bytes loaded for the selected pairing or the open Fonts dialog’s previews; [interface guidance](../../docs/design.md) defines the neutral white palette, self-hosted typography, and responsive navigation. [Push settings](features/push/README.md) registers a push-only service worker after explicit opt-in. No local auth bypass, persisted private content, or service-worker response cache exists. Verification uses API and static checks; browser and visual testing are prohibited.

`public/_headers` sets `Cache-Control: public, max-age=0, must-revalidate, no-transform` for the app and branding HTML pages. This prevents Cloudflare from injecting its Web Analytics script, which our self-only CSP blocks. JavaScript, CSS, and other assets retain normal compression; do not apply `no-transform` globally. The API and media routes keep their separate private/no-store headers. Verify deployed HTML using direct HTTP with compression and an HTML Accept header, checking both response headers and script sources. [Cloudflare documents the injection behavior](https://developers.cloudflare.com/web-analytics/faq/).

Feature `index.ts` files define public entry points; cross-feature consumers use those exports. Boundary tests resolve imports through the TypeScript configuration and check static imports, re-exports, dynamic imports, CommonJS imports, and type imports. Computed module loading is rejected. Dependency cycles and client/server crossings fail the check. On the server, the composition root may mount public router adapters, while routers and the root may not issue database queries.

The independent `public/startup.js` guard recovers a missing/failed main bundle with an explicit reload action; [Welcome](features/welcome/README.md) owns bootstrap recovery after the bundle starts. Both the guard and push worker use revalidation headers.

Events, event editors, the post composer, and Activity load their code on demand through feature public entry points. Feed and profile reads stay in the initial bundle. The member screen boundary announces loading and offers an explicit Reload app action after a chunk/render failure; it never reloads automatically or persists drafts. Old tabs can reference removed chunks after deployment, so this recovery remains necessary. `vite.config.ts` generates one-year immutable browser-cache rules for the exact emitted JS/CSS filenames, which contain content hashes; HTML, the startup guard, and the push worker continue to revalidate. Missing asset paths can fall back to HTML, so no wildcard immutable rule is used. Private APIs/media retain their separate no-store rules. Deployment verification checks every emitted chunk, not only HTML entry assets.
