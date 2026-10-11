# Member screens

Five primary destinations (Feed, Find, New photo, Activity, Profile) organize the app. Hash links support own and other member profiles and back/forward navigation. Each route has a distinct keyed page root so edit forms and list state cannot accumulate across pages. A Node component regression test repeatedly switches pages; no browser or visual testing is used.

`MemberNavigation` owns the shared destination links. CSS presents a desktop icon sidebar with labels revealed on hover/focus and a mobile bottom bar with persistent labels. Links always have explicit accessible names; the profile icon uses the member's avatar when available. Desktop Settings sits at the bottom of the sidebar; mobile Settings is in the white header. Navigation adds no data fetching beyond the authenticated avatar image and no hover state or resize listeners.

Profiles contain identity information, follow controls for other members, and a paginated photo grid when permitted. Settings holds editing, invitations, relationship administration, installation, sign-out, and collapsed account deletion. New members see profile setup and disclosure of mutual follows with their inviter. Usernames cannot change after creation.

Find supports fuzzy matching through the API with a 350 ms debounce and three-character minimum. Clear the field to browse the shuffled directory; cursors retain the seed until a new search/shuffle. All lists use explicit page controls. Private fields are displayed only when supplied by the authorized API.

The initial own profile loads once per member screen mount. Avatar changes update that parent state; profile pages fetch current details. Lists refresh after their mutations. Errors retain inputs and allow retry, and unmounting cancels pending reads. No private data is placed in local storage or a persistent client cache.
