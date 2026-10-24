import { expect, it } from 'vitest';
import { captionParagraphs } from './caption';

it('splits captions at blank lines and keeps single line breaks', () => {
  expect(captionParagraphs('forest spirits of volunteer\n\n10.31.23')).toEqual([
    'forest spirits of volunteer',
    '10.31.23',
  ]);
  expect(captionParagraphs('one\ntwo\n \n\n\nthree')).toEqual([
    'one\ntwo',
    'three',
  ]);
  expect(captionParagraphs('\n\n  First day home.  \n\n')).toEqual([
    'First day home.',
  ]);
  expect(captionParagraphs('  \n ')).toEqual([]);
});
