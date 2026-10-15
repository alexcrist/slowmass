import { describe, expect, it } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import {
  checkMigrationHistory,
  checkMigrationPolicy,
} from '../scripts/ops/check-deploy-migrations.mjs';

const history = (names) => [
  { success: true, results: names.map((name) => ({ name })) },
];

describe('production deployment migration gate', () => {
  it('classifies every checked-in migration', async () => {
    const names = (await readdir('migrations')).filter((name) =>
      name.endsWith('.sql'),
    );
    const policy = JSON.parse(
      await readFile('migrations/deployment-policy.json', 'utf8'),
    );
    expect(() => checkMigrationPolicy(names, policy)).not.toThrow();
  });

  it('allows automatic pending migrations and ignores already-applied manual ones', () => {
    expect(
      checkMigrationHistory(['0001.sql', '0002.sql'], history(['0001.sql']), {
        '0001.sql': 'manual',
        '0002.sql': 'automatic',
      }),
    ).toEqual(['0002.sql']);
  });

  it('blocks the entire batch if any pending migration is manual', () => {
    expect(() =>
      checkMigrationHistory(['0001.sql', '0002.sql'], history([]), {
        '0001.sql': 'automatic',
        '0002.sql': 'manual',
      }),
    ).toThrow('Manual migrations pending: 0002.sql');
  });

  it.each([{}, { '0001.sql': 'auto' }, null, []])(
    'rejects missing or invalid policy: %j',
    (policy) => {
      expect(() =>
        checkMigrationHistory(['0001.sql'], history([]), policy),
      ).toThrow(/policy/);
    },
  );

  it('rejects stale policy entries', () => {
    expect(() => checkMigrationPolicy([], { '0001.sql': 'automatic' })).toThrow(
      'missing file',
    );
  });

  it('still rejects newer production history in automatic mode', () => {
    expect(() =>
      checkMigrationHistory(['0001.sql'], history(['0001.sql', '0002.sql']), {
        '0001.sql': 'automatic',
      }),
    ).toThrow('Unknown: 0002.sql');
  });
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
