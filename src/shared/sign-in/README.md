# Sign-in contract

The email token, invitation claims, email copy, and client instructions share one four-hour lifetime. Better Auth enforces token expiry and single use; membership separately rechecks invitation eligibility. Changing this value affects newly issued links only.

Recovery destinations are rebuilt at the local root, allowing only known error labels and a valid invite/event fragment. The auth adapter and installed-app paste helper use the same restriction; arbitrary URLs, email addresses, and query parameters are discarded. This is navigation context only. Server-side eligibility and email verification still authorize every sign-in.
