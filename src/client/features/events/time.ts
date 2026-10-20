// Event times are UTC instants shown and edited in the event's time zone, so
// guests elsewhere see the host's wall-clock time with its zone name.
type Parts = Record<
  'year' | 'month' | 'day' | 'hour' | 'minute' | 'second',
  number
>;
function zonedParts(ms: number, timeZone: string): Parts {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(new Date(ms))
      .map((part) => [part.type, Number(part.value)]),
  );
  return values as Parts;
}
function offset(ms: number, timeZone: string) {
  const parts = zonedParts(ms, timeZone);
  const wall = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return wall - (ms - (((ms % 1000) + 1000) % 1000));
}
const pad = (value: number) => String(value).padStart(2, '0');

export function currentTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
// Values for date and time inputs showing an instant in a time zone.
export function zonedInput(ms: number, timeZone: string) {
  const parts = zonedParts(ms, timeZone);
  return {
    date: `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`,
    time: `${pad(parts.hour)}:${pad(parts.minute)}`,
  };
}
// The instant for a wall-clock date and time in a time zone. A second pass
// corrects the offset across daylight-saving changes; skipped local times move
// forward by the gap.
export function fromZoned(date: string, time: string, timeZone: string) {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const clock = /^(\d{2}):(\d{2})$/.exec(time);
  if (!day || !clock) return null;
  const wall = Date.UTC(
    Number(day[1]),
    Number(day[2]) - 1,
    Number(day[3]),
    Number(clock[1]),
    Number(clock[2]),
  );
  const first = wall - offset(wall, timeZone);
  const second = wall - offset(first, timeZone);
  const shows = (ms: number) => {
    const input = zonedInput(ms, timeZone);
    return input.date === date && input.time === time;
  };
  if (shows(second)) return second;
  return shows(first) ? first : Math.max(first, second);
}

type When = { startsAt: number; endsAt: number | null; timeZone: string };
function sameDay(a: number, b: number, timeZone: string) {
  const x = zonedParts(a, timeZone);
  const y = zonedParts(b, timeZone);
  return x.year === y.year && x.month === y.month && x.day === y.day;
}
// Two lines for the event page: the date, then the time range with its zone.
export function eventWhen({ startsAt, endsAt, timeZone }: When) {
  const date = new Intl.DateTimeFormat(undefined, {
    timeZone,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year:
      zonedParts(startsAt, timeZone).year ===
      zonedParts(Date.now(), timeZone).year
        ? undefined
        : 'numeric',
  }).format(startsAt);
  const time = new Intl.DateTimeFormat(undefined, {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
  if (endsAt === null) return { date, time: time.format(startsAt) };
  if (sameDay(startsAt, endsAt, timeZone))
    return { date, time: time.formatRange(startsAt, endsAt) };
  return {
    date,
    time: new Intl.DateTimeFormat(undefined, {
      timeZone,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    }).formatRange(startsAt, endsAt),
  };
}
// A time input's wall-clock value, such as 19:00, in the viewer's format.
export function clockTime(value: string) {
  const clock = /^(\d{2}):(\d{2})$/.exec(value);
  if (!clock) return '';
  return new Intl.DateTimeFormat(undefined, {
    timeZone: 'UTC',
    hour: 'numeric',
    minute: '2-digit',
  }).format(Date.UTC(2000, 0, 1, Number(clock[1]), Number(clock[2])));
}
// The time zone's short name at an instant, such as PST or PDT.
export function zoneName(ms: number, timeZone: string) {
  return (
    new Intl.DateTimeFormat(undefined, { timeZone, timeZoneName: 'short' })
      .formatToParts(ms)
      .find((part) => part.type === 'timeZoneName')?.value ?? timeZone
  );
}
// One line for lists and Activity.
export function eventStart({ startsAt, timeZone }: When) {
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(startsAt);
}
