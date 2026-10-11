# Email delivery

The application sends one-time sign-in links through Resend's HTTP API. Better Auth creates and consumes tokens; this transport never invents authentication credentials. Only configured same-origin verification links may be sent. No links, tokens, recipients, or email bodies are logged.

D1 maintains conservative reservations: at most 80 delivery attempts per UTC day for the application and three per recipient per UTC hour. Failed or throttled attempts can consume reservations; this favors bounded spending over maximum capacity. Recipient budget keys use a hash and expire after two days. These records are operational throttles, not analytics. Better Auth also enforces per-IP request limits in D1.

Unknown/ineligible addresses receive the same HTTP success response without a delivery. Configure a verified sender domain and disable email open/link tracking in Resend. The provider will necessarily process recipients and email contents, so the production privacy notice must describe this. Hosted delivery remains unverified until the account is connected.
