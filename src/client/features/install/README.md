# Install support

Slowmass is an online-only installable web app. The root document links a manifest with stable identity/scope, standalone display, and local 192px/512px icons. A separate opaque maskable icon keeps the monogram inside the safe region; iOS uses the existing apple-touch icon.

`InstallProvider` retains the browser's `beforeinstallprompt` event across member page changes. `InstallApp` appears only in Settings and offers a native install button when that capability is available. It consumes each prompt once, handles dismissal/failure, and replaces installation help with installed status after `appinstalled` or in standalone mode (including iOS's standalone flag). Manual instructions cover Safari on iPhone/iPad, Chrome on Android, and supported desktop browsers. No user-agent-based installation claims, automatic prompts, analytics, polling, service worker, or offline storage.

Email links can open a different browser/session from an installed app. The signed-out screen offers a manual unused-link paste flow, documented in the welcome feature. Device installation and session handoff are not browser-tested; the owner can confirm them on their actual phone. Verify manifest/icon metadata, type checking, unit/API tests, and deployment HTTP responses instead.

References: [MDN installability](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable), [install prompt event](https://developer.mozilla.org/en-US/docs/Web/API/BeforeInstallPromptEvent).

Standalone windows may omit browser navigation/reload controls. Content is read when entering a page; reselecting Feed, Activity, or your own Profile fetches the latest first page. Settings offers Reload app for a full reload, and secondary pages have labeled back navigation. Native pull-to-refresh is not required, and no custom pull gesture or automatic refresh is introduced. See [display modes](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/display).
