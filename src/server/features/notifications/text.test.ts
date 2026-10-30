import { expect, it } from 'vitest';
import { notificationText, pushBody } from './text';

const base = {
  key: 'comment:c1',
  postId: 'p1',
  eventId: null,
  eventTitle: null,
  response: null,
  handle: 'alice',
  displayName: 'Alice',
  body: null,
  count: 1,
} as const;

it('describes each category the way Activity does', () => {
  const cases = [
    [
      { category: 'request' },
      'alice requested to follow you.',
      '#notifications/comment:c1',
    ],
    [
      { category: 'follower' },
      'alice started following you.',
      '#notifications/comment:c1',
    ],
    [
      { category: 'joined' },
      'alice joined slowmass through your invitation.',
      '#notifications/comment:c1',
    ],
    [
      { category: 'thread_comment', body: 'Hello' },
      'alice also commented on a photo you commented on.',
      '#post/p1',
    ],
    [
      { category: 'comment_like', body: 'Hello' },
      'alice likes your comment.',
      '#post/p1',
    ],
    [{ category: 'likes', count: 1 }, 'alice likes your photo.', '#post/p1'],
    [
      { category: 'likes', count: 2 },
      'alice and 1 other like your photo.',
      '#post/p1',
    ],
    [
      { category: 'likes', count: 4 },
      'alice and 3 others like your photo.',
      '#post/p1',
    ],
    [
      { category: 'comment', body: 'Nice' },
      'alice commented on your photo.',
      '#post/p1',
    ],
    [
      {
        category: 'event_response',
        eventId: 'e1',
        eventTitle: 'Dinner',
        response: 'maybe',
      },
      'Alice might go to Dinner.',
      '#event/e1',
    ],
    [
      { category: 'event_message', eventId: 'e1', eventTitle: 'Dinner' },
      'Alice posted in Dinner.',
      '#event/e1',
    ],
    [
      { category: 'update_blast', eventId: 'e1', eventTitle: 'Dinner' },
      'Update from Alice: Dinner',
      '#event/e1',
    ],
    [
      { category: 'event_cancelled', eventId: 'e1', eventTitle: 'Dinner' },
      'Alice cancelled Dinner.',
      '#event/e1',
    ],
    [
      { category: 'host_invite', eventId: 'e1', eventTitle: 'Dinner' },
      'Alice asked you to co-host Dinner.',
      '#event/e1',
    ],
    [
      { category: 'host_accepted', eventId: 'e1', eventTitle: 'Dinner' },
      'Alice is now co-hosting Dinner.',
      '#event/e1',
    ],
  ] as const;
  for (const [overrides, summary, path] of cases)
    expect(notificationText({ ...base, ...overrides })).toMatchObject({
      summary,
      path,
    });
});

it('quotes member text in push without splitting characters', () => {
  const text = notificationText({
    ...base,
    category: 'comment',
    body: `${'a'.repeat(158)}🎉🎉 tail`,
  });
  const body = pushBody(text);
  expect(body.startsWith('alice commented on your photo. “')).toBe(true);
  expect(body).toContain('🎉…”');
  expect(pushBody(notificationText({ ...base, category: 'request' }))).toBe(
    'alice requested to follow you.',
  );
});
