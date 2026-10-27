import type { NotificationCategory } from '../../../shared/notification-categories';
import type { DescribedNotification } from './activity';

// What push alerts and emails say. Wording follows the Activity rows; event
// activity names people, since guests never choose a username.
export type NotificationText = {
  // The push title and the event or app the email is about.
  title: string;
  // One sentence: the push body and the email subject.
  summary: string;
  // Member-written text quoted in full in email and shortened in push.
  quote: string | null;
  // The in-app destination, relative to the app origin.
  path: string;
};
type Content = Pick<
  DescribedNotification,
  | 'key'
  | 'category'
  | 'postId'
  | 'eventId'
  | 'eventTitle'
  | 'response'
  | 'handle'
  | 'displayName'
  | 'body'
  | 'count'
>;
const answers = {
  going: 'is going to',
  maybe: 'might go to',
  declined: 'can’t go to',
} as const;

export function notificationText(item: Content): NotificationText {
  const handle = item.handle ?? 'Someone';
  const name = item.displayName ?? handle;
  const event = item.eventTitle ?? 'an event';
  const activity = `#notifications/${item.key}`;
  const eventPath = item.eventId
    ? `#event/${encodeURIComponent(item.eventId)}`
    : activity;
  const postPath = item.postId
    ? `#post/${encodeURIComponent(item.postId)}`
    : activity;
  const sentences: Record<
    NotificationCategory,
    () => Omit<NotificationText, 'quote'>
  > = {
    request: () => ({
      title: 'slowmass',
      summary: `${handle} requested to follow you.`,
      path: activity,
    }),
    follower: () => ({
      title: 'slowmass',
      summary: `${handle} started following you.`,
      path: activity,
    }),
    joined: () => ({
      title: 'slowmass',
      summary: `${handle} joined slowmass through your invitation.`,
      path: activity,
    }),
    likes: () => ({
      title: 'slowmass',
      summary:
        item.count > 1
          ? `${handle} and ${item.count - 1} ${item.count === 2 ? 'other' : 'others'} like your photo.`
          : `${handle} likes your photo.`,
      path: postPath,
    }),
    post: () => ({
      title: 'slowmass',
      summary: `${handle} posted a photo.`,
      path: postPath,
    }),
    comment: () => ({
      title: 'slowmass',
      summary: `${handle} commented on your photo.`,
      path: postPath,
    }),
    event_response: () => ({
      title: event,
      summary: `${name} ${answers[item.response ?? 'going']} ${event}.`,
      path: eventPath,
    }),
    event_message: () => ({
      title: event,
      summary: `${name} posted in ${event}.`,
      path: eventPath,
    }),
    update_blast: () => ({
      title: event,
      summary: `Update from ${name}: ${event}`,
      path: eventPath,
    }),
    event_cancelled: () => ({
      title: event,
      summary: `${name} cancelled ${event}.`,
      path: eventPath,
    }),
    host_invite: () => ({
      title: event,
      summary: `${name} asked you to co-host ${event}.`,
      path: eventPath,
    }),
    host_accepted: () => ({
      title: event,
      summary: `${name} is now co-hosting ${event}.`,
      path: eventPath,
    }),
  };
  return {
    ...sentences[item.category](),
    quote: ['comment', 'post', 'event_message', 'update_blast'].includes(
      item.category,
    )
      ? item.body
      : null,
  };
}

// Push payloads stay well under the 4 KB provider limit.
export function pushBody(text: NotificationText) {
  if (!text.quote) return text.summary;
  // Split by code point so a shortened quote never ends in half an emoji.
  const characters = [...text.quote];
  const quote =
    characters.length > 160
      ? `${characters.slice(0, 159).join('')}…`
      : text.quote;
  return `${text.summary} “${quote.replace(/\s+/g, ' ')}”`;
}
