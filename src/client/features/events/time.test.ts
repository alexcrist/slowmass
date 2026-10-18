import { expect, it } from 'vitest';
import { eventStart, eventWhen, fromZoned, zonedInput } from './time';

it('converts wall-clock inputs in the event time zone, including across DST', () => {
  const zone = 'America/Los_Angeles';
  expect(fromZoned('2026-10-24', '19:00', zone)).toBe(
    Date.UTC(2026, 9, 25, 2, 0),
  );
  expect(fromZoned('2026-12-24', '19:00', zone)).toBe(
    Date.UTC(2026, 11, 25, 3, 0),
  );
  // The repeated hour on the fall-back night resolves to one instant.
  expect(fromZoned('2026-11-01', '01:30', zone)).toBe(
    Date.UTC(2026, 10, 1, 8, 30),
  );
  // A skipped spring-forward time moves past the gap.
  expect(fromZoned('2026-03-08', '02:30', zone)).toBe(
    Date.UTC(2026, 2, 8, 10, 30),
  );
  expect(fromZoned('2026-07-01', '09:15', 'Asia/Kolkata')).toBe(
    Date.UTC(2026, 6, 1, 3, 45),
  );
  expect(fromZoned('2026-7-1', '9:15', zone)).toBeNull();
  for (const [ms, timeZone] of [
    [Date.UTC(2026, 9, 25, 2, 0), zone],
    [Date.UTC(2026, 0, 1, 23, 59), 'Europe/London'],
    [Date.UTC(2026, 5, 30, 18, 45), 'Australia/Adelaide'],
  ] as const) {
    const input = zonedInput(ms, timeZone);
    expect(fromZoned(input.date, input.time, timeZone)).toBe(ms);
  }
  expect(zonedInput(Date.UTC(2026, 9, 25, 2, 0), zone)).toEqual({
    date: '2026-10-24',
    time: '19:00',
  });
});

it('formats event times in the event time zone with its name', () => {
  const zone = 'America/New_York';
  const start = Date.UTC(2030, 0, 5, 0, 0);
  const when = eventWhen({
    startsAt: start,
    endsAt: start + 3 * 3600000,
    timeZone: zone,
  });
  expect(when.date).toContain('January 4');
  expect(when.date).toContain('2030');
  expect(when.time).toMatch(/7:00/);
  expect(when.time).toMatch(/10:00/);
  expect(when.time).toMatch(/EST/);
  const overnight = eventWhen({
    startsAt: start,
    endsAt: start + 30 * 3600000,
    timeZone: zone,
  });
  expect(overnight.time).toMatch(/Jan 4/);
  expect(overnight.time).toMatch(/Jan 6/);
  expect(eventWhen({ startsAt: start, endsAt: null, timeZone: zone })).toEqual({
    date: when.date,
    time: expect.stringMatching(/^7:00\sPM EST$/),
  });
  expect(eventStart({ startsAt: start, endsAt: null, timeZone: zone })).toMatch(
    /Jan 4.*7:00/,
  );
});
