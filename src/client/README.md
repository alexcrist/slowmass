# Client

A static React application served by Workers Assets. The implemented feature is [welcome](features/welcome/README.md). Global styling lives in `styles.css`; visual intent lives in [the design doc](../../docs/design.md).

The browser reads readiness and the authenticated account from the same-origin API. Better Auth's browser client requests one-time email links and ends sessions. There is no local authentication bypass, persisted private content, or service worker.
