import { act, createElement } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { EventAnswers } from './EventSummary';
import { answers, type Answer } from './types';

let renderer: ReactTestRenderer | undefined;
afterEach(async () => {
  if (renderer) await act(async () => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

async function show(
  value: Answer | null,
  busy: boolean,
  onAnswer: (answer: Answer) => void,
) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  await act(async () => {
    const element = createElement(EventAnswers, { value, busy, onAnswer });
    if (renderer) renderer.update(element);
    else renderer = create(element);
  });
}

function option(answer: Answer) {
  return renderer!.root
    .findAllByProps({ className: 'event-answer-slot' })
    .find((slot) => slot.props.id.endsWith(`-${answer}`))!
    .findByType('button');
}

function available() {
  return answers
    .filter(
      (answer) => option(answer.value).parent?.props['aria-hidden'] !== true,
    )
    .map((answer) => answer.value);
}

it.each(answers)(
  'opens and closes the alternatives to a saved $label answer without a mutation',
  async ({ value }) => {
    const onAnswer = vi.fn();
    await show(value, false, onAnswer);
    expect(available()).toEqual([value]);
    expect(option(value).props['aria-pressed']).toBe(true);
    expect(option(value).props['aria-expanded']).toBe(false);
    const controlled = option(value).props['aria-controls'].split(' ');
    expect(controlled).toHaveLength(2);
    for (const id of controlled) {
      const other = renderer!.root.findByProps({ id });
      expect(other.props['aria-hidden']).toBe(true);
      expect(other.findByType('button').props.disabled).toBe(true);
      expect(other.findByType('button').props.tabIndex).toBe(-1);
    }
    await act(async () => option(value).props.onClick());
    expect(available()).toEqual(['going', 'maybe', 'declined']);
    expect(option(value).props['aria-expanded']).toBe(true);
    expect(option(value).props['aria-pressed']).toBe(true);
    await act(async () => option(value).props.onClick());
    expect(available()).toEqual([value]);
    expect(onAnswer).not.toHaveBeenCalled();
  },
);

it('collapses only confirmed changes and leaves failed changes open with the saved answer selected', async () => {
  const onAnswer = vi.fn();
  await show(null, false, onAnswer);
  expect(available()).toEqual(['going', 'maybe', 'declined']);
  await act(async () => option('going').props.onClick());
  expect(onAnswer).toHaveBeenLastCalledWith('going');
  await show(null, true, onAnswer);
  expect(available()).toHaveLength(3);
  await show('going', false, onAnswer);
  expect(available()).toEqual(['going']);
  await act(async () => option('going').props.onClick());
  await act(async () => option('maybe').props.onClick());
  expect(onAnswer).toHaveBeenLastCalledWith('maybe');
  await show('going', true, onAnswer);
  for (const answer of answers)
    expect(option(answer.value).props.disabled).toBe(true);
  // Failed save: the authoritative value stays Going and every option reopens.
  await show('going', false, onAnswer);
  expect(available()).toEqual(['going', 'maybe', 'declined']);
  expect(option('going').props['aria-pressed']).toBe(true);
  expect(option('maybe').props['aria-pressed']).toBe(false);
  await act(async () => option('maybe').props.onClick());
  await show('maybe', false, onAnswer);
  expect(available()).toEqual(['maybe']);
  expect(option('maybe').props['aria-pressed']).toBe(true);
  // A later confirmed change must not restore an old expansion state.
  await show('going', false, onAnswer);
  expect(available()).toEqual(['going']);
});
