# Shared contracts

Dependency-free contracts used by both client and server. [Event appearance](event-appearance/README.md) defines curated identifiers and validation; the event features own rendering, persistence, and authorization. [Event calendar copies](event-calendar/README.md) share provider-link and iCalendar formatting without importing either application layer.

[Sign-in](sign-in/README.md) keeps the email-token/claim lifetime and user-facing duration aligned, and restricts failed-link recovery to local invitation routes.
