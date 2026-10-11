# Interface guidance

The interface takes its direction from early photo-sharing apps: a compact forest-green header, lowercase script wordmark, white photo frames, and a narrow chronological feed. This basic brand direction was approved on October 10, 2026. Copy remains functional, without slogans or marketing messages.

## Type and color

- Lobster Two bold italic: the text-only `slowmass` wordmark.
- Source Sans 3: headings, controls, captions, and body text. Use 400 and 600 weights with system fallbacks.
- Forest green `#234b38`: header, primary actions, selected navigation.
- Cream `#fff9ec`: wordmark on the header.
- Off-white `#f3f3ef`: page background; white `#ffffff`: forms and photo frames.
- Ink `#29362e`: body text; gray `#627066`: secondary text; pale gray `#dbe1da`: boundaries.

Both fonts are served locally from `public/fonts`, with their SIL Open Font Licenses included. No third-party font or image requests. The reusable wordmark is also available at `/slowmass-wordmark.svg` as standalone vector outlines.

## Layout and interaction

The main content is left aligned in a column up to 640px wide. Sign-in uses a smaller form. Feed, Find, New photo, Activity, and Profile are the five primary destinations; their navigation sits below the header on desktop and at the bottom on mobile, with safe-area spacing. Icons always have text labels. Profile contains photos, editing, follow requests, following, followers, invitations, and blocked accounts. Activity also links to follow requests. New members are shown profile setup before using profile-dependent screens.

Photos retain their full aspect ratio. Captions and interactions sit inside the same white frame. Lists use explicit page controls. Preserve clear loading, empty, error, and confirmation states, visible keyboard focus, and controls at least 44px tall. No automatic animation, engagement gimmicks, or invented social activity.

Verification uses static checks and API/integration tests only. Browser testing, screenshot inspection, and visual regression testing are prohibited by the user.
