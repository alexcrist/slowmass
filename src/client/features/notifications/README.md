# Notifications

A member opens this tab to load current in-app activity; no background polling occurs. Follow requests can be accepted or denied here. Grouped likes and comments open an authenticated post detail. Read acknowledgement is explicit and limited to the displayed page. Navigation uses cursor history; refresh resets to current activity. All errors, loading, empty, and unread states are text-based.

Successful follow decisions and read acknowledgements switch the affected list to loading while refreshing, so old actionable requests and unread labels cannot linger as if nothing changed. Failed reads expose retry without suggesting an empty page.
