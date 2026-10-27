-- Email cancelled events by default. Guests who joined through an event link
-- often have no push, and a cancellation is rare and time-sensitive. Members
-- who saved a choice for this category keep it.
UPDATE notification_category SET email=1 WHERE id='event_cancelled';
