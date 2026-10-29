import { act, createElement } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  colorThemes,
  fontPairings,
  parseAppearance,
  type EventAppearance,
} from '../../../shared/event-appearance';
import { appearanceDocument } from '../../../../tests/support/appearance-document';
import { palettes, pairings } from './appearance';
import { useEventAppearance } from './useEventAppearance';

let renderer: ReactTestRenderer | undefined;
afterEach(async () => {
  if (renderer) await act(async () => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});
function luminance(hex: string) {
  const rgb = [1, 3, 5].map((index) => {
    const value = parseInt(hex.slice(index, index + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
function contrast(a: string, b: string) {
  const values = [luminance(a), luminance(b)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}
it('keeps readable text, action labels and focus indicators across light and evening palettes', () => {
  for (const [name, p] of Object.entries(palettes)) {
    for (const background of [p.paper, p.surface, p.hover]) {
      for (const foreground of [p.ink, p.detail, p.danger])
        expect(
          contrast(foreground, background),
          `${name}: ${foreground} on ${background}`,
        ).toBeGreaterThanOrEqual(4.5);
    }
    expect(
      contrast(p.navInk, p.nav),
      `${name} navigation`,
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(p.muted, p.paper),
      `${name} secondary text`,
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(p.onBrand, p.brand),
      `${name} action`,
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(p.onBrand, p.brandHover),
      `${name} hovered action`,
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(p.onDanger, p.danger),
      `${name} destructive action`,
    ).toBeGreaterThanOrEqual(4.5);
    expect(contrast(p.brand, p.paper), `${name} focus`).toBeGreaterThanOrEqual(
      3,
    );
    if (name !== 'original')
      expect(
        contrast(p.controlLine, p.surface),
        `${name} input outline`,
      ).toBeGreaterThanOrEqual(3);
  }
});
it('accepts only the curated contract, with complete presentation definitions', () => {
  expect(Object.keys(palettes)).toEqual([...colorThemes]);
  expect(Object.keys(pairings)).toEqual([...fontPairings]);
  for (const colorTheme of colorThemes)
    for (const fontPairing of fontPairings)
      expect(parseAppearance({ colorTheme, fontPairing })).toEqual({
        colorTheme,
        fontPairing,
      });
  for (const value of [
    null,
    [],
    'pool',
    {},
    { colorTheme: 'constructor', fontPairing: 'classic' },
    { colorTheme: 'pool', fontPairing: 'url(https://example.com/font)' },
  ])
    expect(parseAppearance(value)).toBeNull();
});
it('applies heading fonts only during an event and restores root styles and browser color', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const { root, themeColor } = appearanceDocument();
  root.style.setProperty('--paper', 'ivory', 'important');
  root.style.setProperty('--unrelated', 'keep');
  vi.stubGlobal('document', {
    documentElement: root,
    querySelector: () => themeColor,
  });
  function Page({ appearance }: { appearance?: EventAppearance }) {
    useEventAppearance(appearance);
    return null;
  }
  await act(async () => {
    renderer = create(createElement(Page));
  });
  expect(root.style.getPropertyValue('--heading-font')).toBe('');
  expect(root.getAttribute('data-event-appearance')).toBeNull();
  await act(async () =>
    renderer?.update(
      createElement(Page, {
        appearance: { colorTheme: 'wine', fontPairing: 'classic' },
      }),
    ),
  );
  expect(root.style.getPropertyValue('--heading-font')).toBe(
    pairings.classic.heading,
  );
  // Body text, navigation, and the logo keep the app's own faces.
  expect(root.style.getPropertyValue('--body-font')).toBe('');
  expect(root.style.getPropertyValue('--wordmark-font')).toBe('');
  expect(root.style.getPropertyValue('--ink')).toBe(palettes.wine.ink);
  expect(root.style.getPropertyValue('--control-line')).toBe(
    palettes.wine.controlLine,
  );
  expect(root.style.getPropertyValue('color-scheme')).toBe('dark');
  expect(themeColor.getAttribute('content')).toBe(palettes.wine.nav);
  await act(async () =>
    renderer?.update(
      createElement(Page, {
        appearance: { colorTheme: 'pool', fontPairing: 'bungee-shade' },
      }),
    ),
  );
  expect(root.style.getPropertyValue('--heading-font')).toBe(
    pairings['bungee-shade'].heading,
  );
  expect(root.style.getPropertyValue('--heading-weight')).toBe('400');
  expect(root.getAttribute('data-event-appearance')).toBe('pool');
  await act(async () => renderer?.update(createElement(Page)));
  expect(root.style.getPropertyValue('--paper')).toBe('ivory');
  expect(root.style.getPropertyPriority('--paper')).toBe('important');
  expect(root.style.getPropertyValue('--unrelated')).toBe('keep');
  expect(root.style.getPropertyValue('--heading-font')).toBe('');
  expect(root.style.getPropertyValue('--heading-weight')).toBe('');
  expect(root.getAttribute('data-event-appearance')).toBeNull();
  expect(root.getAttribute('data-event-font')).toBeNull();
  expect(themeColor.getAttribute('content')).toBe('#ffffff');
});
it('ships local content-addressed fonts without preloading unselected faces', () => {
  const css = readFileSync('src/client/features/events/fonts.css', 'utf8');
  const faces = [...css.matchAll(/@font-face\s*\{([^}]+)\}/g)];
  expect(faces).toHaveLength(5);
  let totalBytes = 0;
  for (const [, face] of faces) {
    expect(face).toContain('font-display: swap');
    const url = /url\(([^)]+)\)/.exec(face)?.[1];
    expect(url).toMatch(/^\/fonts\/events\/[a-z-]+-[a-f0-9]{12}\.woff2$/);
    const bytes = readFileSync(`public${url}`);
    expect(bytes.subarray(0, 4).toString()).toBe('wOF2');
    expect(url).toContain(
      createHash('sha256').update(bytes).digest('hex').slice(0, 12),
    );
    expect(bytes.byteLength).toBeLessThan(80_000);
    totalBytes += bytes.byteLength;
  }
  // The intricate Rubik outlines are larger, but the full picker stays below
  // the previous catalog's 205 KB and only selected faces load on event pages.
  expect(totalBytes).toBeLessThan(170_000);
  // Normal app styles never select extra faces. Opening the Fonts dialog
  // references the catalog for previews; there is still no global preload.
  const global = readFileSync('src/client/styles.css', 'utf8');
  // The logo in the sidebar and phone header never takes an event face.
  expect(global).toMatch(/\.site-name \{[^}]*font-family: 'Caveat', cursive;/);
  const html = readFileSync('index.html', 'utf8');
  expect(html).not.toMatch(/rel=["']preload["']/);
  for (const name of [
    'Fraunces',
    'Bungee Shade',
    'Monoton',
    'Fascinate Inline',
    'Rubik Wet Paint',
  ])
    expect(global).not.toContain(name);
});
