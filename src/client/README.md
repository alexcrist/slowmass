# Client

A static React application served by Workers Assets. [Welcome](features/welcome/README.md) handles email login and logout, then mounts [member screens](features/people/README.md). These compose [invitations](features/invitations/README.md), [avatars](features/avatars/README.md), [posts](features/posts/README.md), [interactions](features/interactions/README.md), and [notifications](features/notifications/README.md), using the shared [API client](api/README.md).

[Install support](features/install/README.md) adds a standalone web-app manifest, install instructions, and browser install prompts where available.

[Account deletion](features/account/README.md) is available from Settings.

Global styling lives in `styles.css`; [interface guidance](../../docs/design.md) defines the neutral white palette, self-hosted typography, and responsive navigation. No local auth bypass, persisted private content, or service worker exists. Verification uses API and static checks; browser and visual testing are prohibited.

`public/_headers` sets `Cache-Control: public, max-age=0, must-revalidate, no-transform` for the app and branding HTML pages. This prevents Cloudflare from injecting its Web Analytics script, which our self-only CSP blocks. JavaScript, CSS, and other assets retain normal compression; do not apply `no-transform` globally. The API and media routes keep their separate private/no-store headers. Verify deployed HTML using direct HTTP with compression and an HTML Accept header, checking both response headers and script sources. [Cloudflare documents the injection behavior](https://developers.cloudflare.com/web-analytics/faq/).
