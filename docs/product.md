# Product contract

Status: core MVP and account deletion are implemented. See the implementation plan for verification, deployment, and remaining operational work.

## Experience

A mobile-first place to share single photos with friends. The feed is reverse chronological, finite per page, and contains only authors the viewer currently follows through an accepted request. There is no recommendation algorithm or engagement ranking.

- Sign in through a one-time email link that confirms email ownership. No passwords or social login. Choose a unique handle and display name during onboarding.
- Every member must be invited by an active member. Bind invitations to verified email addresses, and permanently retain who invited whom and when. Bootstrap only the first account through a configured verified email. Invitations expire after seven days; five per member per rolling day is the initial limit. Members share the app URL themselves after creating an invitation; automatic invitation email is deferred. Preserve minimal invitation-tree tombstones through account deletion. Mass-ban tools are deferred.
- Each account has an avatar and plain-text bio. Signed-in, unblocked members can view a profile's username, name, avatar, and their follow-request state. Bios, posts, and relationship lists remain private. Anonymous profile URLs reveal no profile data. Profiles have an identity header and a paginated photo grid; account administration and installation help live in Settings.
- Inviter and invitee follow each other automatically when both finish creating their profiles. This is disclosed before joining. Subsequent unfollowing or blocking is respected; edits and sign-ins never restore a relationship. Existing completed profiles are not retroactively connected.
- Find people by name or username with case-insensitive fuzzy matching (letters in order, allowing skipped letters), a three-character minimum, and a 350 ms debounce. An empty search shows a shuffled member directory with explicit pages and stable ordering during pagination. Blocked and inactive members are excluded. Searches are limited to 30 per member per minute.
- Send, cancel, accept, or deny follow requests. Unfollow, remove a follower, and block an account. Blocking removes relationships and pending requests in both directions and prevents new interactions. Unblocking does not restore follows.
- Publish exactly one still photo with an optional plain-text caption and optional author-written alt text. Preview before publishing; preserve the chosen aspect ratio. Show a clear unsupported-format message when conversion cannot be performed.
- View own posts on the profile and navigate there after posting. Own posts are excluded from the home feed unless the product decision changes; do not create a synthetic self-follow.
- Feed cards show the author's username and avatar, linking to their profile. Like/unlike and comment controls use accessible icons and positive counts. Clicking the like count opens a paginated list of members who liked the post. Comments are flat and paginated. Authors can delete their comments; post owners can delete comments on their posts. Post owners can delete posts. Caption editing is deferred.
- Show in-app notifications for follow requests, likes, and comments, with unread state and safe links. Group likes per post; display authoritative current counts. Activity includes All and Follow requests filters, with requests accepted or denied in place. No SMS, email activity digests, or push notifications initially.
- Use explicit Newer/Older page navigation, preserve navigation state, and show an accessible check-circle icon at the end of posts. Load images near the viewport without automatically fetching another page.
- Provide logout and account deletion. Deletion immediately removes visibility and schedules retryable object cleanup. Document backup retention separately from live deletion.

## Privacy semantics

Access is evaluated at request time. A removed follower cannot fetch more posts, bios, or post media, including through an old image URL. Content already downloaded cannot be recalled. Blocking also hides the blocked account's profile, avatar, and interactions, and notification rendering rechecks current access. Avatars require active membership and no block in either direction; an accepted follow is not required.

In-app actions need friendly errors and retry behavior. Losing a connection during publication must not create duplicate posts or lose the ability to determine whether publication succeeded.

## Deferred

Native app-store releases, public profiles, contact import, videos, animated images, albums, stories, reels, DMs, hashtags, location features, filters, resharing, recommendations, ads, payments, push/email activity notifications, and offline private-photo storage.

## Product quality

Use a restrained photo-first design with a single-column feed, clear navigation, and accessible controls. Verify narrow phones through desktop layouts, keyboard and touch flows, reduced motion, screen-reader labels, and slow-network states. Never depend on color alone to communicate state.

Magic-link login remains the default for both joining and returning members. After requesting a link, returning to the app rechecks the current session without polling. Installed apps can have separate browser sessions; an optional, collapsed unused-link helper is shown only in the installed app. No email-code or password flow is introduced.
