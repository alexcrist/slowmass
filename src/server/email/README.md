# Email delivery

The application sends one-time sign-in links through Resend's HTTP API, including those for signing in through an event link. Authentication and membership own credentials; this transport never invents them. Only configured same-origin verification/join links may be sent. No links, tokens, recipients, or email bodies are logged. Login mail retains generic responses when throttled.

D1 maintains conservative reservations: at most 80 delivery attempts per UTC day for the application and three per recipient per UTC hour. Failed or throttled attempts can consume reservations; this favors bounded spending over maximum capacity. Recipient budget keys use a hash and expire after two days. These records are operational throttles, not analytics. Better Auth also enforces per-IP request limits in D1.

Addresses without an account or working event link receive an explicit invitation-required error without a delivery. The optional reply-to inbox can differ from the sending domain. Configure a verified sender domain and disable email open/link tracking in Resend. The provider will necessarily process recipients and email contents, so the production privacy notice must describe this. Production sign-in delivery is verified; tests use a simulated Resend boundary and send no real email.

The email module owns scheduled cleanup of expired budget records, bounded to 100 records per pass; the composition root only invokes it.
