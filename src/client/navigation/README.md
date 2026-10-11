# Navigation

Hash routes give the single-page client shareable profiles and browser Back/Forward behavior without a router dependency. Route roots are keyed so forms, requests, and local state are unmounted on page changes. Private navigation remains behind the authenticated member shell.

Legacy `#requests` links resolve to Activity. `BackControl` uses labeled anchors for parent destinations and buttons for returning from an inline photo detail; both use the same arrow and touch target. Parent links are deterministic, so direct entry never relies on an unknown browser history entry.
