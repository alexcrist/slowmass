# App and notification icons

The app icons retain the approved `sm` identity described in [the design guide](../../docs/design.md).

`notification-badge.svg` takes the first outlined Caveat bold `s` from `../slowmass-wordmark.svg`, centered on a transparent square with white fill. Its 96×96 PNG export is the push notification badge for Android status bars; keep the alpha channel when regenerating it. The service worker supplies the PNG separately from the larger app icon. Other platforms may ignore the badge.
