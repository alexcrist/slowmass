import { expect, it } from 'vitest';
import { calendarFile, calendarLinks, type CalendarEvent } from './index';

const origin = 'https://slowmass.com';
const event = {
  id: '11111111-2222-4333-8444-555555555555',
  title: 'Dinner & games 🪩',
  description: 'Bring a dish; snacks, too.\nMeet <outside> #2?',
  location: '1 Main St, Apt #2 & courtyard',
  startsAt: Date.UTC(2030, 2, 10, 9, 30),
  endsAt: Date.UTC(2030, 2, 10, 10, 30),
  timeZone: 'America/Los_Angeles',
  url: `${origin}/#event/${'a'.repeat(48)}`,
} satisfies CalendarEvent & { url: string };
const unfold = (value: string) => value.replace(/\r\n /g, '');

it('encodes provider links with exact UTC instants across daylight saving and a credential-free return link', () => {
  const links = calendarLinks(event, origin);
  const google = new URL(links.google);
  const outlook = new URL(links.outlook);
  expect(google.origin).toBe('https://calendar.google.com');
  expect(google.searchParams.get('text')).toBe(event.title);
  expect(google.searchParams.get('dates')).toBe(
    '20300310T093000Z/20300310T103000Z',
  );
  expect(google.searchParams.get('stz')).toBe(event.timeZone);
  expect(google.searchParams.get('etz')).toBe(event.timeZone);
  expect(google.searchParams.get('location')).toBe(event.location);
  expect(google.searchParams.get('details')).toBe(
    `${event.description}\n\n${origin}/#event/${event.id}`,
  );
  expect(outlook.origin).toBe('https://outlook.live.com');
  expect(outlook.searchParams.get('subject')).toBe(event.title);
  expect(outlook.searchParams.get('startdt')).toBe('2030-03-10T09:30:00.000Z');
  expect(outlook.searchParams.get('enddt')).toBe('2030-03-10T10:30:00.000Z');
  expect(outlook.searchParams.get('location')).toBe(event.location);
  expect(outlook.searchParams.get('body')).toBe(
    google.searchParams.get('details'),
  );
  for (const value of Object.values(links))
    expect(decodeURIComponent(value)).not.toContain(event.url);
});

it('uses the same disclosed one-hour default across calendars, including midnight rollover', () => {
  const startOnly = {
    ...event,
    startsAt: Date.UTC(2030, 11, 31, 23, 30),
    endsAt: null,
  };
  const links = calendarLinks(startOnly, origin);
  expect(new URL(links.google).searchParams.get('dates')).toBe(
    '20301231T233000Z/20310101T003000Z',
  );
  expect(new URL(links.outlook).searchParams.get('enddt')).toBe(
    '2031-01-01T00:30:00.000Z',
  );
  expect(unfold(calendarFile(startOnly, origin, 0))).toContain(
    'DTEND:20310101T003000Z\r\n',
  );
});

it('exports a private single event with stable identity, full details and no guests or invitation credential', () => {
  const first = unfold(calendarFile(event, origin, Date.UTC(2030, 0, 1)));
  const next = unfold(calendarFile(event, origin, Date.UTC(2030, 0, 2)));
  expect(first).toContain(`UID:${event.id}@slowmass.com\r\n`);
  expect(next).toContain(`UID:${event.id}@slowmass.com\r\n`);
  expect(first).toContain('DTSTAMP:20300101T000000Z\r\n');
  expect(first).toContain('DTSTART:20300310T093000Z\r\nDTEND:20300310T103000Z');
  expect(first).toContain(`SUMMARY:${event.title}\r\n`);
  expect(first).toContain(
    'DESCRIPTION:Bring a dish\\; snacks\\, too.\\nMeet <outside> #2?',
  );
  expect(first).toContain(`URL:${origin}/#event/${event.id}\r\n`);
  expect(first).toContain('CLASS:PRIVATE\r\n');
  expect(first).not.toMatch(/ATTENDEE:|ORGANIZER:|ATTACH:|METHOD:REQUEST/);
  expect(first).not.toContain(event.url);
  expect(first.endsWith('END:VEVENT\r\nEND:VCALENDAR\r\n')).toBe(true);
});

it('escapes injected calendar properties and folds UTF-8 without breaking characters', () => {
  const input = {
    ...event,
    title: 'Hello\r\nEND:VEVENT\nBEGIN:VEVENT\rATTENDEE:bad@example.com',
    description: 'é🪩\\,;'.repeat(500) + '\u0000',
  };
  const file = calendarFile(input, origin, 0);
  const lines = file.split('\r\n');
  expect(lines.filter((line) => line === 'BEGIN:VEVENT')).toHaveLength(1);
  expect(lines.filter((line) => line === 'END:VEVENT')).toHaveLength(1);
  expect(lines.some((line) => line.startsWith('ATTENDEE:'))).toBe(false);
  expect(
    lines.every((line) => new TextEncoder().encode(line).length <= 75),
  ).toBe(true);
  expect(unfold(file)).toContain(
    'SUMMARY:Hello\\nEND:VEVENT\\nBEGIN:VEVENT\\nATTENDEE:bad@example.com',
  );
  expect(unfold(file)).toContain('DESCRIPTION:' + 'é🪩\\\\\\,\\;'.repeat(500));
  expect(file).not.toMatch(/\u0000|\ufffd/);
});
