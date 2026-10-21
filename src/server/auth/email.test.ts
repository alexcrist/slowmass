import { expect, it } from 'vitest';
import { canonicalEmail } from './email';

it('collapses only consumer Gmail aliases', () => {
  for (const email of [
    'First.Last@gmail.com',
    'firstlast+tag@gmail.com',
    ' first.last+tag@googlemail.com ',
  ])
    expect(canonicalEmail(email)).toBe('firstlast@gmail.com');
  for (const email of [
    'first.last+tag@example.com',
    'first.last@gmail.com.evil.test',
    'first.last+tag@workspace.example',
  ])
    expect(canonicalEmail(email)).toBe(email);
  expect(canonicalEmail(' Person@Example.com ')).toBe('person@example.com');
});
