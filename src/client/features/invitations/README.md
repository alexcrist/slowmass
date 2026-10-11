# Invitations

Create an invitation bound to a specific email under Settings. The confirmation provides a copyable message with the app URL, invited address, and explanation of mutual follows. It states that the member sends the message themselves; no invitation email was sent. Server-side eligibility and issuance limits are authoritative.

An explicitly paginated history shows recipient, creation time, and pending/joined/expired/cancelled status. Only unused invitations can be cancelled. Cancelling retains the record and timestamp for incident review. Existing members keep their access.

Creating or cancelling an invitation reloads the history with an explicit loading state, hiding the prior empty message or pending status until the new result arrives. Read errors have a separate retry control from invitation mutation errors.
