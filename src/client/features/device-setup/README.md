# Device setup

One optional suggestion at the top of Activity asks mobile members to get notifications on this device and, on Android, to install the app. It appears right after onboarding, never during it, and only on Activity; a dialog opens only when the member taps Show how. It uses the Activity row layout and app icon, but it is not a server activity item: it has no timestamp, read receipt, or push alert.

`deviceSetupStep` chooses at most one step from account and device facts:

- iPhone/iPad browser: add slowmass to the Home Screen. The summary says this is a first step. Show how opens a dialog explaining that notifications only work in the Home Screen app and are turned on there, with the install feature's numbered steps plus a final step (In Activity, tap Turn on, then Allow), and a Done button. Adding to the Home Screen alone enables nothing. A browser tab cannot tell whether this device already has the Home Screen app, so a live push subscription on any device (bootstrap `pushSubscribed`) hides it.
- iPhone/iPad Home Screen app: turn on notifications. Installation is never suggested there.
- Android: turn on notifications first; afterward, or when notifications were already blocked or unsupported, offer the browser's native install prompt while one is available. A missing prompt usually means the app is installed, so manual Android instructions remain in Settings only.
- Desktop, a member who answered No, or nothing left to do: no row.

Each step has a × dismiss control matching Activity's follow-back dismissal, labeled for screen readers (“Dismiss notification suggestion” or “Dismiss install suggestion”). Dismissing answers No, which is permanent for the account. It deletes the server's pending `device_setup` row through the existing authenticated API, so every device stops showing the row. Blocking the permission prompt opened from the row, or dismissing the install prompt it opened, also counts as No. A failed save keeps the row and its actions for retry. Completing the last step shows a status until the member navigates away; the row is then gone because nothing remains for this device. Turning notifications on elsewhere does not answer No: Android can still offer installation.

Turn on reuses the push feature's opt-in, so permission is requested only from that tap and registration/ownership rules are unchanged. Which step to show uses this device's local permission and subscription (`localPushState`), refreshed on focus, visibility return, and navigation without network requests. The row's own `usePush` instance supplies the server-confirmed status and enable action, and mounts only on Activity.

Each step adds one to the Activity badge on this device until its summary is at least half visible for 250 ms, using the notifications visibility rule. Seen steps are kept in `localStorage` as a presentation hint, not consent. If storage is unavailable, seen state lasts for the page load. iPhone browser tabs and Home Screen apps have separate storage, so the app counts its notifications step once more.

Previews: run `npm run dev:ui` and open `/previews/device-setup.html`. It renders every device permutation and row state with the app stylesheet beside static sample Activity rows, at selectable phone widths; Show how opens the real dialog. The production build includes only `index.html`, so the preview is not deployed.

Node tests cover step selection, Android notifications-then-install, accepted and dismissed install prompts, permanent and retried dismissal, permission denial, iPhone browser and Home Screen app, desktop, and seen persistence. They simulate browser APIs; real-device installation and OS delivery are not verified.
