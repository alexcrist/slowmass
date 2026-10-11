# Interface guidance

The interface takes its direction from early photo-sharing apps: a compact Douglas Fir green header, lowercase script wordmark, white photo frames, and a narrow chronological feed. This basic brand direction was approved on October 10, 2026. Copy remains functional, without slogans or marketing messages.

## Type and color

- Caveat bold: the text-only `slowmass` wordmark.
- Source Sans 3: headings, controls, captions, and body text. Use 400 and 600 weights with system fallbacks.
- Douglas Fir `#214c3b`: header, primary actions, selected navigation.
- Cream `#f6f7ed`: wordmark on the header.
- Off-white `#f0f2ec`: page background; white `#ffffff`: forms and photo frames.
- Ink `#29362e`: body text; gray `#627066`: secondary text; pale gray `#dbe1da`: boundaries.

Both fonts are served locally from `public/fonts`, with their SIL Open Font Licenses included. No third-party font or image requests. The reusable wordmark is also available at `/slowmass-wordmark.svg` as standalone vector outlines.

## Layout and interaction

The main content is left aligned in a column up to 640px wide. Sign-in uses a smaller form. Feed, Find, New photo, Activity, and Profile are the five primary destinations; their navigation sits below the header on desktop and at the bottom on mobile, with safe-area spacing. Icons always have text labels. Profile contains photos, editing, follow requests, following, followers, invitations, and blocked accounts. Activity also links to follow requests. New members are shown profile setup before using profile-dependent screens.

Photos retain their full aspect ratio. Captions and interactions sit inside the same white frame. Lists use explicit page controls. Preserve clear loading, empty, error, and confirmation states, visible keyboard focus, and controls at least 44px tall. No automatic animation, engagement gimmicks, or invented social activity.

Verification uses static checks and API/integration tests only. Browser testing, screenshot inspection, and visual regression testing are prohibited by the user.

## Branding comparison

`/branding/` is a standalone, public, noindex design preview. Caveat is the confirmed wordmark font. Five PNW evergreen-inspired palettes are available: Deep Pine, Douglas Fir (selected), Western Redcedar, Sitka Spruce, and Western Hemlock. These are artistic color directions, not botanical color specifications. Selections are stored only in the URL fragment and do not change the application theme or account data. Preview scripts load only on that page and make no API requests. The app uses Douglas Fir and Caveat.

## Favicon

The selected favicon is the original lowercase `sm` monogram: Caveat bold in cream on a rounded Douglas Fir tile. `/favicon.svg` preserves the approved vector geometry. `/favicon.ico` contains 16px, 32px, and 48px versions; `/apple-touch-icon.png` is a 180px version with an opaque Douglas Fir background for home-screen use. These assets are linked from the application document. The temporary favicon comparison page was removed after selection.

## Installed app

The main document links `/manifest.webmanifest` for standalone launches from `/`. Home-screen installation uses the selected `sm` icon, including a maskable variant. A compact expandable Install Slowmass section provides native installation when supported and manual platform instructions otherwise; it is hidden in the installed window. Safe-area spacing accommodates the top status bar and bottom navigation. The app requires a network connection. It has no service worker, offline photo cache, or push notifications. The sign-in screen supports pasting an unused email link to authenticate within the installed app's own session.
