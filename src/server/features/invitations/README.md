# Member invitations

An active verified member can invite a specific email. The route bounds and validates input and derives the inviter exclusively from the session. Membership owns issuance limits and atomic acceptance. A successful response creates an eligibility record, not an email delivery. Duplicate/limited requests return a conflict without revealing another member's invitation history.

Each invitation retains its server-assigned creation time in Unix milliseconds, including invitations that expire or are revoked. Database triggers prevent rewriting the inviter, recipient, or creation time. Acceptance records the member’s join time separately. This supports later investigation by inviter and issuance window. Because invitations are shared manually, creation time is not an email-delivery timestamp; a future email transport must track send attempts separately.
