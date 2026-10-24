# Development tools

`npm run db:seed` replaces local development D1/R2 (`.wrangler/state`) with a synthetic community, then prints the account to sign in with. Stop `npm run dev` first; the script refuses to run while port 8787 is in use. It never touches remote resources.

The bootstrap member uses `BOOTSTRAP_EMAIL` from `.dev.vars` with the username `alex`. Eight synthetic members (`@example.invalid` addresses, which cannot receive email) join through a personal-invitation tree below it, so invitation provenance and the automatic inviter follows are real. Additional follows, two pending requests to the bootstrap member, about 25 posts, comments on every post, and likes come from the application's own API, so drafts, image processing, quotas, storage ledgers, and Activity triggers run as they do for members. Sign in afterward with an email link or the development Google client, as usual.

The script writes users, invitations, memberships, and short-lived sessions directly, signing session cookies with Better Auth's `makeSignature` and `AUTH_SECRET`, as the integration-test runtime does. Those sessions are deleted before the script exits. All content is created at seed time, so timestamps read as just now; rewriting them would have to keep Activity, receipts, and push-delivery triggers consistent.

Photos are random dogs from the public [dog.ceo API](https://dog.ceo/dog-api/) (Stanford Dogs dataset images), downloaded once into `.wrangler/seed-photos/` and reused by later runs. They are for local development only. Do not commit them or use them in tests or production. Delete that directory to fetch a new set. The first run needs network access; failures stop the script rather than seeding partial content silently.
