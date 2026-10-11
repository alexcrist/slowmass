# Member screens

Plain account navigation provides profile creation/editing, exact-handle lookup, incoming follow requests, following/follower lists, blocked accounts, and invitations. Private fields are displayed only when supplied by the authorized API. Lists have explicit Previous/Next controls. Profile handles are fixed after creation; the form explains this constraint.

The initial profile is loaded once per member screen mount. Each list/view refreshes after its own mutation. Errors retain inputs and allow retry. Unmounting cancels pending list/profile reads. No private data is placed in local storage or a persistent client cache.
