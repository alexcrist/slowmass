import { describe, expect, it } from 'vitest';
import { checkMigrationHistory } from '../scripts/ops/check-deploy-migrations.mjs';

const history = (names) => [
  { success: true, results: names.map((name) => ({ name })) },
];

describe('production deployment migration gate', () => {
  it('accepts matching history regardless of order', () => {
    expect(() =>
      checkMigrationHistory(
        ['0001.sql', '0002.sql'],
        history(['0002.sql', '0001.sql']),
      ),
    ).not.toThrow();
  });

  it('blocks code requiring an unapplied migration', () => {
    expect(() =>
      checkMigrationHistory(['0001.sql', '0002.sql'], history(['0001.sql'])),
    ).toThrow('Pending: 0002.sql');
  });

  it('blocks older code when production has an unknown migration', () => {
    expect(() =>
      checkMigrationHistory(['0001.sql'], history(['0001.sql', '0002.sql'])),
    ).toThrow('Unknown: 0002.sql');
  });

  it.each([
    null,
    [],
    [{}],
    [{ success: false, results: [] }],
    [{ success: true, results: [{}] }],
  ])('fails closed on invalid provider output: %j', (response) => {
    expect(() => checkMigrationHistory(['0001.sql'], response)).toThrow(
      'Invalid production migration history',
    );
  });
});
