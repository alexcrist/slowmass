# Interface guidance

Status: account/sign-in screen implemented; application screens planned.

Keep the interface utilitarian. Identify the app with the plain name Slowmass. Do not create a brand identity, logo, slogan, promotional message, or decorative illustration. Product copy should explain actions, requirements, status, and errors.

Use the system sans-serif stack and a neutral palette: white background, dark text and buttons, gray secondary text and borders. Reserve color for functional states such as errors and keyboard focus. Use ordinary type sizes and weights with no stylized lettering.

The account screen uses a compact header and a left-aligned form in a bounded column. Keep inputs readable on phones, controls at least 44px tall, and keyboard focus visible. Preserve clear loading, unavailable, error, and confirmation states.

Future screens should follow the same approach: functional navigation, full-width photos in a bounded feed column, left-aligned captions, and explicit page controls. Private profiles must never cause requests to third-party image or font hosts. No decorative animations, engagement badges, or invented social activity.

Verification uses static checks and API/integration tests only. Browser testing, screenshot inspection, and visual regression testing are prohibited by the user.
