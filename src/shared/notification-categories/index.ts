// Categories members choose push and email for, in Settings order. Their
// defaults live in the database (migration 0037) beside the triggers that use
// them; this list only names and describes them.
export const notificationCategories = [
  { id: 'request', label: 'Follow requests' },
  { id: 'follower', label: 'New followers' },
  { id: 'joined', label: 'People you invited joining' },
  { id: 'likes', label: 'Likes on your photos' },
  { id: 'comment', label: 'Comments on your photos' },
  { id: 'event_response', label: 'RSVPs to events you host' },
  { id: 'event_message', label: 'Event messages' },
  { id: 'update_blast', label: 'Update blasts from hosts' },
  { id: 'event_cancelled', label: 'Cancelled events' },
] as const;
export type NotificationCategory =
  (typeof notificationCategories)[number]['id'];
export function isNotificationCategory(
  value: unknown,
): value is NotificationCategory {
  return notificationCategories.some((category) => category.id === value);
}
export function notificationCategoryLabel(id: NotificationCategory) {
  return notificationCategories.find((category) => category.id === id)!.label;
}
