# Welcome

Shows a neutral loading state until both service availability and the current session are known. Only a confirmed signed-out response reveals the email sign-in form; a failed request shows an error with retry instead. The static HTML supplies the same loading message before JavaScript starts. Missing credentials show an availability message; network and link errors are distinct. The generic sent state does not reveal whether an address has an invitation.

Signed-in members see the member application; sign-out is available under Settings. The header uses the locally hosted text wordmark, and signed-out members see a bounded email sign-in form. The same magic-link flow handles invited new members and returning members, followed by profile setup when needed.

After requesting a link, focus/visibility return events recheck the current session, without polling. A manual check button gives an explicit status if that window still has no session. This cannot transfer a session between isolated browsers.

Installed apps may have a separate session from the browser opened by an email link. Only standalone windows show the collapsed `PasteLoginLink` helper, letting the member copy an unused link from email and consume it inside the app. Regular browser login has no pasted-link form. The input is masked and never logged or persisted. Validation accepts only the current origin's exact Better Auth verification path, rejects credentials/duplicate or missing tokens, and reconstructs the URL with fixed local success/error callbacks. Better Auth remains responsible for expiry, single use, membership eligibility, and session cookies. No new token issuer, session-transfer endpoint, or auth bypass is introduced. Copying an already-used link requires requesting a new one.
