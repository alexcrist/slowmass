import { expect, it } from 'vitest';
import { parseDescription } from './description';

const strong = (...children: unknown[]) => ({ tag: 'strong', children });
const em = (...children: unknown[]) => ({ tag: 'em', children });
const del = (...children: unknown[]) => ({ tag: 'del', children });

it('formats bold, italic, and strikethrough', () => {
  expect(
    parseDescription('**bring** *snacks* ~~and~~ __chairs__ _ok_'),
  ).toEqual([
    strong('bring'),
    ' ',
    em('snacks'),
    ' ',
    del('and'),
    ' ',
    strong('chairs'),
    ' ',
    em('ok'),
  ]);
});

it('nests markers', () => {
  expect(parseDescription('***both***')).toEqual([strong(em('both'))]);
  expect(parseDescription('*a **b** c*')).toEqual([
    em('a ', strong('b'), ' c'),
  ]);
  expect(parseDescription('~~**gone**~~')).toEqual([del(strong('gone'))]);
});

it('leaves unmatched and spaced markers as text', () => {
  expect(parseDescription('2 * 3 * 4')).toEqual(['2 * 3 * 4']);
  expect(parseDescription('* item\n* item')).toEqual(['* item\n* item']);
  expect(parseDescription('**open')).toEqual(['**open']);
  expect(parseDescription('**a*')).toEqual(['*', em('a')]);
  expect(parseDescription('****')).toEqual(['****']);
  expect(parseDescription('~~~three~~~')).toEqual(['~~~three~~~']);
  expect(parseDescription('~~ spaced~~')).toEqual(['~~ spaced~~']);
});

it('strikes through with one or two tildes', () => {
  expect(parseDescription('~one~ ~~two~~')).toEqual([
    del('one'),
    ' ',
    del('two'),
  ]);
  expect(parseDescription('~a~~b~')).toEqual([del('a~~b')]);
  expect(parseDescription('~~a~b~~')).toEqual([del('a~b')]);
  expect(parseDescription('~~mixed~')).toEqual(['~~mixed~']);
  expect(parseDescription('x~y~z')).toEqual(['x', del('y'), 'z']);
});

it('keeps underscores inside words', () => {
  expect(parseDescription('snake_case_name and _x_y')).toEqual([
    'snake_case_name and _x_y',
  ]);
});

it('does not pair markers across lines', () => {
  expect(parseDescription('**one\ntwo**')).toEqual(['**one\ntwo**']);
  expect(parseDescription('**one**\n*two*')).toEqual([
    strong('one'),
    '\n',
    em('two'),
  ]);
});

it('honors backslash escapes', () => {
  expect(parseDescription('\\*not\\* \\\\ C:\\path')).toEqual([
    '*not* \\ C:\\path',
  ]);
  expect(parseDescription('*a \\* b*')).toEqual([em('a * b')]);
});
