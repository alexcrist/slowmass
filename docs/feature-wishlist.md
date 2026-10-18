# Feature wishlist

Future features; not yet implemented.

- Tag users in comments.
- Send a weekly unread-notification email on Sundays at 10:00 a.m. Pacific time (`America/Los_Angeles`, following daylight saving time). Send only to members who have unread notifications and whose email preferences allow it. List each eligible unread notification, respecting current visibility and access rules. Include an unsubscribe link that disables these emails and updates the member's notification preferences. Sending the email does not mark notifications as read.
- Add a Notification preferences page accessible from Settings, where members can customize which notifications they receive through Web Push and email, including the weekly email. These preferences affect delivery only: Activity continues to show all notifications allowed by current visibility rules and keeps its numbered unread badge regardless of push or email preferences.

## Private events

Partiful-inspired events for organizing get-togethers with friends on Slowmass. Requested October 14, 2026; wishlist discussion only, with no implementation scheduled. The ideas below are proposals, not an approved product contract.

Members could organize dinners, birthdays, trips, or casual meetups with the friends they share photos with. Keep an Events area for invitations and upcoming/past gatherings, with explicit pagination; preserve the chronological photo feed.

Possible first version:

- A host creates an event with a title, description, date/time and time zone, location, and optional cover photo.
- The host invites selected members; invitees can respond Going, Maybe, or Can't go and change their response. The host can review responses, remove guests, edit details, or cancel the event.
- Invitees receive invitations, material changes, and cancellation notices in Activity, with optional Web Push governed by delivery preferences. Consider a bounded reminder and an add-to-calendar download; disclose that an exported calendar entry cannot enforce later access revocation or guarantee updated details.
- Restrict event details, addresses, guest lists, and cover images to authorized members. Event participation grants no access to private posts or bios and creates no follow relationships. Define host/guest blocking, guest removal, and account deletion behavior before building.

Decisions to resolve:

- **Friends who have not joined:** starting with existing members keeps the first version small, but requiring full profile setup before RSVP adds friction for occasional guests. Decide whether to retain that requirement or propose a separate guest experience. Any path that creates a Slowmass membership must verify email, require an active member's invitation, and preserve permanent inviter attribution. An event link alone must not expose private details or bypass admission rules.
- **Guest control:** decide whether invitees can see each other and their responses, forward invitations, or bring a plus-one; start with host-controlled invitations and a host-only guest list as the conservative proposal. Event access should be explicit and separate from following the host.

Consider capacity/waitlists, recurring events, and event discussion after the basic invitation/RSVP flow. Photo posts could later reference an event while retaining their existing audience; shared albums remain outside the current scope. Defer ticketing, payments, public event discovery, and SMS. Prefer the existing application and notification infrastructure, with bounded invitation/reminder delivery and measured costs before adding services.
