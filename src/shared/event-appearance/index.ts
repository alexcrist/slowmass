// Persist only curated IDs. Neither hosts nor link previews can supply CSS,
// font URLs, or other executable presentation data.
export const colorThemes = [
  'original',
  'pool',
  'lilac',
  'citrus',
  'cherry',
  'after-hours',
  'wine',
  'evergreen',
  'candlelight',
] as const;
export const fontPairings = [
  'original',
  'handwritten',
  'classic',
  'bungee-shade',
  'monoton',
  'fascinate-inline',
  'rubik-wet-paint',
] as const;
export type ColorTheme = (typeof colorThemes)[number];
export type FontPairing = (typeof fontPairings)[number];
export type EventAppearance = {
  colorTheme: ColorTheme;
  fontPairing: FontPairing;
};
export const originalAppearance: EventAppearance = {
  colorTheme: 'original',
  fontPairing: 'original',
};
export function parseAppearance(value: unknown): EventAppearance | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { colorTheme, fontPairing } = value as Record<string, unknown>;
  const color = colorThemes.find((id) => id === colorTheme);
  const font = fontPairings.find((id) => id === fontPairing);
  return color && font ? { colorTheme: color, fontPairing: font } : null;
}
