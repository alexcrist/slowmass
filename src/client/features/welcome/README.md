# Welcome

Introduces Slowmass and requests a one-time email link when the backend is configured. Missing credentials disable sign-in with an honest availability message; network and link errors are distinct. The generic sent state does not reveal whether an address has an invitation.

Signed-in members see the member application; sign-out is available under Profile. The header uses the locally hosted text wordmark, and signed-out members see a bounded email sign-in form.

Installed apps may have a separate session from the browser opened by an email link. `PasteLoginLink` lets the member copy an unused link from their email and consume it inside the current app window. The input is masked and never logged or persisted. Validation accepts only the current origin's exact Better Auth verification path, rejects credentials/duplicate or missing tokens, and reconstructs the URL with fixed local success/error callbacks. Better Auth remains responsible for expiry, single use, membership eligibility, and session cookies. No new token issuer, session-transfer endpoint, or auth bypass is introduced. Copying an already-used link requires requesting a new one.
