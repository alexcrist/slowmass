# Interface guidance

The interface uses a white canvas with neutral text and navigation, keeping colored surfaces away from photos. The October 11, 2026 direction replaces the green header and off-white background while retaining the lowercase script wordmark and Douglas Fir primary buttons. Copy remains functional, without slogans or marketing messages.

## Type and color

- Caveat bold: the text-only `slowmass` wordmark.
- Source Sans 3: headings, controls, captions, and body text. Use 400 and 600 weights with system fallbacks.
- White `#ffffff`: page, header, sidebar, forms, and photo surrounds.
- Ink `#171717`: wordmark, body text, navigation, and interaction icons.
- Gray `#737373`: secondary text; light gray `#e5e5e5`: boundaries.
- Neutral `#f5f5f5`: navigation hover/active state and avatar placeholders.
- Douglas Fir `#214c3b`: primary action buttons only, with white labels.

Both fonts are served locally from `public/fonts`, with their SIL Open Font Licenses included. No third-party font or image requests. The reusable wordmark is also available at `/slowmass-wordmark.svg` as standalone vector outlines.

## Layout and interaction

Content is left aligned inside a centered column up to 640px wide; the desktop feed narrows to 520px. Sign-in uses a smaller form. Feed, Find, New photo, Activity, and Profile are the five primary destinations. At 900px and above, a fixed 72px icon sidebar expands to 216px on pointer hover or keyboard focus, revealing labels without shifting the content. The Caveat `sm` abbreviation expands to `slowmass`; Settings stays at the bottom. Each link retains an accessible name while its visible label is collapsed. The sidebar scrolls on short screens and its transition respects reduced motion.

Below 900px, the white header shows the wordmark and Settings, and the five primary destinations form a fixed bottom bar with labels and safe-area spacing. Profiles show username, name, avatar, permitted bio, and a three-column photo grid. A separate Settings page contains editing, invitations, relationship administration, installation, sign-out, and account deletion. Activity also links to follow requests. New members are shown profile setup before using profile-dependent screens.

Feed and detail photos retain their full aspect ratio. Profile thumbnails use square crops; opening one shows the full photo. Feed headers show only the author's username and avatar alongside the timestamp. Heart and comment icons have accessible names and positive counts; the like count opens the people list. Thin neutral separators replace raised card frames and tinted surfaces. Lists use explicit page controls. Preserve clear loading, empty, error, and confirmation states, visible keyboard focus, and controls at least 44px tall. No automatic animation, engagement gimmicks, or invented social activity.

Verification uses static checks and API/integration tests only. Browser testing, screenshot inspection, and visual regression testing are prohibited by the user.

## Branding comparison

`/branding/` preserves the earlier standalone, public, noindex palette comparison. It contains the original five PNW evergreen palette samples, rather than the current white application layout. Caveat and Douglas Fir were selected there; green is now limited to application primary actions and the approved app icon. These are artistic color directions, not botanical color specifications. Preview selections live only in the URL fragment and do not change the application theme or account data. Preview scripts load only on that page and make no API requests.

## Favicon

The selected favicon is the original lowercase `sm` monogram: Caveat bold in cream on a rounded Douglas Fir tile. `/favicon.svg` preserves the approved vector geometry. `/favicon.ico` contains 16px, 32px, and 48px versions; `/apple-touch-icon.png` is a 180px version with an opaque Douglas Fir background for home-screen use. These assets are linked from the application document. The temporary favicon comparison page was removed after selection.

## Installed app

The main document links `/manifest.webmanifest` for standalone launches from `/`. Browser theme and launch background colors are white. Home-screen installation uses the selected `sm` icon, including a maskable variant. Settings contains an expandable Install Slowmass section with native installation when supported and manual platform instructions otherwise. An installed window shows its installed status instead. Safe-area spacing accommodates the top status bar and bottom navigation. The app requires a network connection. It has no service worker, offline photo cache, or push notifications. Magic links remain the primary login flow; only the installed app shows collapsed help for pasting an unused link when email opens a separate browser session.
