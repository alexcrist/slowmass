import { describe, expect, it } from 'vitest';
import { normalizeEmail } from '../membership';

describe('invitation email identity', () => {
  it('normalizes case and whitespace without collapsing distinct addresses', () => {
    expect(normalizeEmail(' Friend@Example.com ')).toBe('friend@example.com');
    expect(normalizeEmail('friend+other@example.com')).not.toBe(
      normalizeEmail('friend@example.com'),
    );
    expect(normalizeEmail('friend@example.com.evil.test')).not.toBe(
      normalizeEmail('friend@example.com'),
    );
  });
});
