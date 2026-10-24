// Categories members choose push and email for, in Settings order and grouped
// as Settings shows them. Their defaults live in the database (migration 0037)
// beside the triggers that use them; this list only names and describes them.
export const notificationCategories = [
  { id: 'request', group: 'People', label: 'Follow requests' },
  { id: 'follower', group: 'People', label: 'New followers' },
  { id: 'joined', group: 'People', label: 'People you invited joining' },
  { id: 'likes', group: 'Photos', label: 'Likes on your photos' },
  { id: 'comment', group: 'Photos', label: 'Comments on your photos' },
  { id: 'event_response', group: 'Events', label: 'RSVPs to events you host' },
  { id: 'event_message', group: 'Events', label: 'Event messages' },
  { id: 'update_blast', group: 'Events', label: 'Update blasts from hosts' },
  { id: 'event_cancelled', group: 'Events', label: 'Cancelled events' },
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
