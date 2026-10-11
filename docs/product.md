# Product contract

Status: proposed MVP, not implemented.

## Experience

A mobile-first place to share single photos with friends. The feed is reverse chronological, finite per page, and contains only authors the viewer currently follows through an accepted request. There is no recommendation algorithm or engagement ranking.

- Sign in through a one-time email link that confirms email ownership. No passwords or social login. Choose a unique handle and display name during onboarding.
- Every member must be invited by an active member. Bind invitations to verified email addresses, and permanently retain who invited whom and when. Bootstrap only the first account through a configured verified email. Invitations expire after seven days; five per member per rolling day is the initial limit. Members share the app URL themselves after creating an invitation; automatic invitation email is deferred. Preserve minimal invitation-tree tombstones through account deletion. Mass-ban tools are deferred.
- Each account has an avatar and plain-text bio. An authenticated exact-handle lookup shows only the handle/display name and follow-request state to strangers. Avatar, bio, posts, and relationship lists remain private. Anonymous profile URLs reveal no profile data.
- Send, cancel, accept, or deny follow requests. Unfollow, remove a follower, and block an account. Blocking removes relationships and pending requests in both directions and prevents new interactions. Unblocking does not restore follows.
- Publish exactly one still photo with an optional plain-text caption and optional author-written alt text. Preview before publishing; preserve the chosen aspect ratio. Show a clear unsupported-format message when conversion cannot be performed.
- View own posts on the profile and navigate there after posting. Own posts are excluded from the home feed unless the product decision changes; do not create a synthetic self-follow.
- Like/unlike and comment on accessible posts. Comments are flat and paginated. Authors can delete their comments; post owners can delete comments on their posts. Post owners can delete posts. Caption editing is deferred.
- Show in-app notifications for follow requests, likes, and comments, with unread state and safe links. Group likes per post; display authoritative current counts. No SMS, email activity digests, or push notifications initially.
- Use explicit Newer/Older page navigation, preserve navigation state, and show a caught-up/end state. Load images near the viewport without automatically fetching another page.
- Provide logout and account deletion. Deletion immediately removes visibility and schedules retryable object cleanup. Document backup retention separately from live deletion.

## Privacy semantics

Access is evaluated at request time. A removed follower cannot fetch more content or media, including through an old image URL. Content already downloaded cannot be recalled. Blocking also hides the blocked account's interactions from the blocker, and notification rendering rechecks current access. Profile avatars uploaded to this app follow the same authorization rules as posts.

In-app actions need friendly errors and retry behavior. Losing a connection during publication must not create duplicate posts or lose the ability to determine whether publication succeeded.

## Deferred

Native app-store releases, public profiles, broad user search/contact import, videos, animated images, albums, stories, reels, DMs, hashtags, location features, filters, resharing, recommendations, ads, payments, push/email activity notifications, and offline private-photo storage.

## Product quality

Use a restrained photo-first design with a single-column feed, clear navigation, and accessible controls. Verify narrow phones through desktop layouts, keyboard and touch flows, reduced motion, screen-reader labels, and slow-network states. Never depend on color alone to communicate state.

These defaults keep the build executable. strict profile metadata privacy, and excluding own posts from home can be changed before implementation without changing the core architecture.
