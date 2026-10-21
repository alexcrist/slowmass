# Google sign-in visual review

Status: owner approved the email-first layout; the identity migration and hosted rollout are complete. Google branding is approved and published. Completed real-account sign-in verification remains outstanding.

Run `npm run dev:ui`. Open `http://localhost:5173/previews/google-sign-in.html` (use the port Vite reports if 5173 is occupied). This development-only page renders the real welcome screen with synthetic data. Its top toolbar switches the page, state, and event theme. Google clicks simulate failure or pending status; email submission simulates the sent screen. No actual login or email occurs.

## First pass: placement and hierarchy

| Review        | Preview URL                                           | What to assess                                                             |
| ------------- | ----------------------------------------------------- | -------------------------------------------------------------------------- |
| Normal login  | `/previews/google-sign-in.html?flow=normal`           | Email above Google, divider spacing, readable invite-only guidance, footer |
| Member invite | `/previews/google-sign-in.html?flow=invite`           | “You’re invited to slowmass”, same button placement, clear joining copy    |
| Event invite  | `/previews/google-sign-in.html?flow=event`            | Cover/title/date remain prominent; sign-in choices directly below          |
| Dark event    | `/previews/google-sign-in.html?flow=event&theme=dark` | White Google button, divider and email contrast in After hours theme       |

Review each at phone width first, then desktop width. Feedback can name the page and change, for example “Event: reduce the gap below the date” or “All: increase the divider spacing.” The toolbar is review-only and takes extra space above the real screen.

## Second pass: interaction states

- Click Google in Ready mode: review the inline error and restored choices.
- Select “Click Google for loading”, then click Google: review disabled controls; pending status is screen-reader-only.
- Select “Returned from Google”: review cancellation/failure copy and both retry options.
- Select “Unavailable invitation”: review existing-member fallback and invitation explanation.
- Select “Google not configured”: confirm the original email-only layout is still clear.
- Submit any synthetic email: review the email confirmation/resend screen; Google is intentionally absent there.
- Tab through controls: review visible focus and sensible order.

## Before release

The owner approved email first, then the “or” divider and Google button. The manual account-identity migration and matching backend/UI are deployed. Complete real Google sign-in and magic-link account-reuse checks for all three entry paths. Local previews and synthetic integration tests do not prove Google's live callback behavior. No automated browser or visual testing is performed.
