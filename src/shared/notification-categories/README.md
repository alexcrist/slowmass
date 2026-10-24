# Notification categories

The categories members choose push alerts and email for, with their Settings labels. They name Activity kinds, except that event messages split into ordinary messages, update blasts and cancellations. Defaults are not here: they live in the `notification_category` table, where the delivery triggers read them, and the server returns each member's effective choices. Adding a category needs a migration row and a matching entry here.
