import { expect, it } from 'vitest';
import { overflowMenuPosition } from './overflow-menu-position';

const bounds = { left: 8, top: 8, right: 382, bottom: 720 };
const menu = { width: 168, height: 142 };

it('opens below when it fits and aligns to the trigger right edge', () => {
  expect(
    overflowMenuPosition(
      { left: 330, right: 374, top: 156, bottom: 200 },
      menu,
      bounds,
    ),
  ).toEqual({ left: 206, top: 204, maxHeight: 516 });
});

it('opens above when the bottom is obstructed', () => {
  expect(
    overflowMenuPosition(
      { left: 330, right: 374, top: 606, bottom: 650 },
      menu,
      bounds,
    ),
  ).toEqual({ left: 206, top: 460, maxHeight: 594 });
});

it('constrains tall menus to the side with more space', () => {
  expect(
    overflowMenuPosition(
      { left: 330, right: 374, top: 300, bottom: 344 },
      { width: 168, height: 900 },
      bounds,
    ),
  ).toEqual({ left: 206, top: 348, maxHeight: 372 });
});

it('constrains tall upward menus to the upper edge', () => {
  expect(
    overflowMenuPosition(
      { left: 330, right: 374, top: 500, bottom: 544 },
      { width: 168, height: 900 },
      bounds,
    ),
  ).toEqual({ left: 206, top: 8, maxHeight: 488 });
});

it.each([
  { left: -20, right: 24 },
  { left: 380, right: 424 },
])('keeps horizontal edges within the viewport for %j', (horizontal) => {
  const position = overflowMenuPosition(
    { ...horizontal, top: 156, bottom: 200 },
    menu,
    bounds,
  );
  expect(position.left).toBeGreaterThanOrEqual(bounds.left);
  expect(position.left + menu.width).toBeLessThanOrEqual(bounds.right);
});

it('respects a narrow, offset visual viewport', () => {
  expect(
    overflowMenuPosition(
      { left: 100, right: 144, top: 260, bottom: 304 },
      menu,
      { left: 90, right: 220, top: 200, bottom: 450 },
    ),
  ).toEqual({ left: 90, top: 308, maxHeight: 142 });
});
