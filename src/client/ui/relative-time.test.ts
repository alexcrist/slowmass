import { expect, it } from 'vitest';
import { shortAge } from './RelativeTime';
it('uses minute, hour, day, week and year boundaries without months or negative ages', () => {
  for (const [minutes, expected] of [
    [-1, 'now'],
    [0, 'now'],
    [0.9, 'now'],
    [1, '1m'],
    [8, '8m'],
    [59, '59m'],
    [60, '1h'],
    [8 * 60 + 59, '8h'],
    [1440, '1d'],
    [6 * 1440, '6d'],
    [7 * 1440, '1w'],
    [8 * 7 * 1440, '8w'],
    [364 * 1440, '52w'],
    [365 * 1440, '1y'],
    [8 * 365 * 1440, '8y'],
  ] as const)
    expect(shortAge(0, minutes * 60000)).toBe(expected);
});
