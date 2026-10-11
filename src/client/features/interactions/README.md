# Interaction controls

Post cards receive counts and like state with the post response. Like mutations are idempotent, and a detail request refreshes authoritative counts after changes. Comments load only when expanded, with explicit paging, a labeled text field, and permission-controlled deletion. A comment submission retains its UUID for unchanged retries. Network errors remain visible with retry controls; private content is not persisted in browser storage.

Heart and comment controls use icons with accessible names and positive counts. The heart toggles the like; the adjacent count opens a paginated Liked by list of username/avatar profile links. Comment authors use username profile links. Profile names are kept on profile pages.
