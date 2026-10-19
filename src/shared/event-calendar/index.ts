export type CalendarEvent = {
  id: string;
  title: string;
  description: string;
  location: string;
  startsAt: number;
  endsAt: number | null;
  timeZone: string;
};

// Give calendar copies a useful duration when the host supplied only a start.
// The picker discloses this default; it does not change the slowmass event.
function endTime(event: CalendarEvent) {
  return event.endsAt ?? event.startsAt + 60 * 60 * 1000;
}
function timestamp(ms: number) {
  return new Date(ms)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}
function eventUrl(event: CalendarEvent, origin: string) {
  // Calendar copies must not carry the invitation credential. This route
  // requires a signed-in member with existing access to the event.
  return `${new URL(origin).origin}/#event/${encodeURIComponent(event.id)}`;
}
function description(event: CalendarEvent, origin: string) {
  return [event.description, eventUrl(event, origin)]
    .filter(Boolean)
    .join('\n\n');
}

export function calendarLinks(event: CalendarEvent, origin: string) {
  const google = new URL('https://calendar.google.com/calendar/r/eventedit');
  google.search = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    dates: `${timestamp(event.startsAt)}/${timestamp(endTime(event))}`,
    stz: event.timeZone,
    etz: event.timeZone,
    details: description(event, origin),
    location: event.location,
  }).toString();
  const outlook = new URL(
    'https://outlook.live.com/calendar/0/deeplink/compose',
  );
  outlook.search = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: event.title,
    startdt: new Date(event.startsAt).toISOString(),
    enddt: new Date(endTime(event)).toISOString(),
    allday: 'false',
    body: description(event, origin),
    location: event.location,
  }).toString();
  return { google: google.href, outlook: outlook.href };
}

// RFC 5545 TEXT escaping prevents user-entered newlines from injecting
// calendar properties. Strip unsupported control characters as well.
function text(value: string) {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}
function fold(line: string) {
  const encoder = new TextEncoder();
  let output = '';
  let bytes = 0;
  for (const character of line) {
    const size = encoder.encode(character).length;
    if (bytes + size > 75) {
      output += '\r\n ';
      bytes = 1;
    }
    output += character;
    bytes += size;
  }
  return output;
}

export function calendarFile(
  event: CalendarEvent,
  origin: string,
  now: number,
) {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//slowmass//Events//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${event.id}@${new URL(origin).hostname}`,
    `DTSTAMP:${timestamp(now)}`,
    `DTSTART:${timestamp(event.startsAt)}`,
    `DTEND:${timestamp(endTime(event))}`,
    `SUMMARY:${text(event.title)}`,
    `DESCRIPTION:${text(description(event, origin))}`,
    `LOCATION:${text(event.location)}`,
    `URL:${eventUrl(event, origin)}`,
    'CLASS:PRIVATE',
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ]
    .map(fold)
    .join('\r\n');
}
