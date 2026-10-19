import { useLayoutEffect } from 'react';
import type { EventAppearance } from '../../../shared/event-appearance';
import { palettes, pairings } from './appearance';

// The mounted event page/preview is the sole owner, including its dialogs.
// Root variables cover navigation portals, the document canvas and safe areas.
// Cleanup runs before the next paint, with no stored preference or late fetch
// callback that could recolor the next route.
export function useEventAppearance(appearance?: EventAppearance) {
  const colorTheme = appearance?.colorTheme;
  const fontPairing = appearance?.fontPairing;
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (!root || !colorTheme || !fontPairing) return;
    const palette = palettes[colorTheme];
    const fonts = pairings[fontPairing];
    const properties: Record<string, string> = {
      '--paper': palette.paper,
      '--ink': palette.ink,
      '--muted': palette.muted,
      '--line': palette.line,
      '--control-line': palette.controlLine,
      '--hover': palette.hover,
      '--detail': palette.detail,
      '--brand': palette.brand,
      '--brand-hover': palette.brandHover,
      '--on-brand': palette.onBrand,
      '--danger': palette.danger,
      '--on-danger': palette.onDanger,
      '--disabled': colorTheme === 'original' ? '#999999' : palette.hover,
      '--on-disabled': colorTheme === 'original' ? '#ffffff' : palette.muted,
      '--overlay': palette.overlay,
      '--image-overlay': palette.imageOverlay,
      '--viewer-ink': palette.viewerInk,
      '--viewer-hover':
        colorTheme === 'original' ? 'rgb(255 255 255 / 15%)' : palette.overlay,
      '--menu-shadow': `${palette.ink}14`,
      '--body-font': fonts.body,
      '--heading-font': fonts.heading,
      '--wordmark-font': fonts.wordmark,
      '--heading-weight': fontPairing === 'original' ? '600' : '700',
      'color-scheme': palette.scheme,
    };
    const previous = Object.keys(properties).map((key) => ({
      key,
      value: root.style.getPropertyValue(key),
      priority: root.style.getPropertyPriority(key),
    }));
    const attribute = root.getAttribute('data-event-appearance');
    const fontAttribute = root.getAttribute('data-event-font');
    const themeColor = document.querySelector('meta[name="theme-color"]');
    const previousColor = themeColor?.getAttribute('content');
    root.setAttribute('data-event-appearance', colorTheme);
    root.setAttribute('data-event-font', fontPairing);
    for (const [key, value] of Object.entries(properties))
      root.style.setProperty(key, value);
    themeColor?.setAttribute('content', palette.paper);
    return () => {
      for (const { key, value, priority } of previous) {
        if (value) root.style.setProperty(key, value, priority);
        else root.style.removeProperty(key);
      }
      if (attribute === null) root.removeAttribute('data-event-appearance');
      else root.setAttribute('data-event-appearance', attribute);
      if (fontAttribute === null) root.removeAttribute('data-event-font');
      else root.setAttribute('data-event-font', fontAttribute);
      if (previousColor != null)
        themeColor?.setAttribute('content', previousColor);
      else themeColor?.removeAttribute('content');
    };
  }, [colorTheme, fontPairing]);
}
