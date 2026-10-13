# Email delivery

The application sends invitations and one-time sign-in links through Resend's HTTP API. Authentication and membership own credentials; this transport never invents them. Only configured same-origin verification/join links may be sent. No links, tokens, recipients, or email bodies are logged. Invitation delivery supplies a frozen payload and idempotency key; its persisted credential-bearing payload is encrypted by the invitations module. Login mail retains generic responses when throttled, while invitation delivery can report a retryable limit.

D1 maintains conservative reservations: at most 80 delivery attempts per UTC day for the application and three per recipient per UTC hour. Failed or throttled attempts can consume reservations; this favors bounded spending over maximum capacity. Recipient budget keys use a hash and expire after two days. These records are operational throttles, not analytics. Better Auth also enforces per-IP request limits in D1.

Unknown/ineligible addresses receive an explicit invitation-required error without a delivery. The optional reply-to inbox can differ from the sending domain. Configure a verified sender domain and disable email open/link tracking in Resend. The provider will necessarily process recipients and email contents, so the production privacy notice must describe this. Production sign-in delivery is verified; invitation transport tests use a simulated Resend boundary and do not send real invitations.

The email module owns scheduled cleanup of expired budget records, bounded to 100 records per pass; the composition root only invokes it.
