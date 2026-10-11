# Membership and invitations

Membership is separate from an authenticated identity. A verified email can join only through an unexpired invitation issued by a currently active member. Active means membership status is `active`, not a recent activity score. The first verified account matching the operator's bootstrap email is the only root; a database constraint prevents a second root.

Invitations are tied to exact normalized email addresses. Normalization trims whitespace and lowercases; it does not merge aliases. Members create an invitation and share the app URL themselves. Invitation creation does not send an email. Invitations expire after seven days, and each member can issue five per rolling 24 hours. Retrying an outstanding invitation does not create another record. These are conservative beta defaults.

The oldest still-valid invitation is credited when multiple members invite the same address. Joining inserts membership and consumes that invitation atomically through D1 triggers. Membership retains inviter, invitation, and join time; provenance cannot be rewritten. Disabling an inviter before acceptance invalidates pending invitations. It does not automatically disable existing descendants. Bulk-ban functionality is not implemented.

Invitation and membership records must survive account cleanup as minimal tombstones so descendant attribution remains available. Delete personal profile/email content separately; do not cascade-delete the invitation graph. `membership_inviter` supports future descendant traversal. Status exists to enforce eligibility, not as a completed moderation interface.

The auth module uses these rules during user/session creation. Every private application endpoint must additionally require current active membership. Integration tests exercise joining, provenance, and revoked eligibility against local D1.

Inviter and invitee automatically follow each other once both have profiles. The initial-profile trigger checks both members are active and neither has blocked the other. Profile edits and subsequent sign-ins never recreate removed relationships. This applies when completing a profile after migration 0011; existing completed pairs are not backfilled. The invitation and onboarding UI disclose the mutual connection.
