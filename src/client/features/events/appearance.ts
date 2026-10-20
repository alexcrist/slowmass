import type { ColorTheme, FontPairing } from '../../../shared/event-appearance';

type Palette = {
  name: string;
  scheme: 'light' | 'dark';
  paper: string;
  // Replace neutral input surfaces, dividers and control outlines with tones
  // from the palette; outlines stay stronger than structural separators.
  surface: string;
  ink: string;
  muted: string;
  line: string;
  controlLine: string;
  hover: string;
  detail: string;
  brand: string;
  brandHover: string;
  onBrand: string;
  danger: string;
  onDanger: string;
  viewerInk: string;
  overlay: string;
  imageOverlay: string;
};

export const palettes: Record<ColorTheme, Palette> = {
  original: {
    name: 'Original',
    scheme: 'light',
    paper: '#ffffff',
    surface: '#ffffff',
    ink: '#171717',
    muted: '#737373',
    line: '#e5e5e5',
    controlLine: '#d4d4d4',
    hover: '#f5f5f5',
    detail: '#171717',
    brand: '#214c3b',
    brandHover: '#193e30',
    onBrand: '#ffffff',
    danger: '#a42b25',
    onDanger: '#ffffff',
    viewerInk: '#ffffff',
    overlay: 'rgb(0 0 0 / 45%)',
    imageOverlay: 'rgb(0 0 0 / 85%)',
  },
  pool: {
    name: 'Pool',
    scheme: 'light',
    paper: '#e5f3ff',
    surface: '#f1f8ff',
    ink: '#182d4b',
    muted: '#435b76',
    line: '#b5cce4',
    controlLine: '#607c9c',
    hover: '#d2e6fb',
    detail: '#244bc5',
    brand: '#244bc5',
    brandHover: '#1d3d9e',
    onBrand: '#ffffff',
    danger: '#a12a40',
    onDanger: '#ffffff',
    viewerInk: '#e5f3ff',
    overlay: 'rgb(24 45 75 / 55%)',
    imageOverlay: 'rgb(24 45 75 / 96%)',
  },
  lilac: {
    name: 'Lilac',
    scheme: 'light',
    paper: '#efe7fa',
    surface: '#f7f2fc',
    ink: '#352340',
    muted: '#675270',
    line: '#cebcdd',
    controlLine: '#8a6c9e',
    hover: '#e1d4ef',
    detail: '#663a80',
    brand: '#663a80',
    brandHover: '#512e66',
    onBrand: '#ffffff',
    danger: '#9a2947',
    onDanger: '#ffffff',
    viewerInk: '#efe7fa',
    overlay: 'rgb(53 35 64 / 55%)',
    imageOverlay: 'rgb(53 35 64 / 96%)',
  },
  citrus: {
    name: 'Citrus',
    scheme: 'light',
    paper: '#fff4bc',
    surface: '#fff9df',
    ink: '#303515',
    muted: '#616336',
    line: '#d5cd96',
    controlLine: '#858253',
    hover: '#f0e6a6',
    detail: '#525c22',
    brand: '#525c22',
    brandHover: '#414a1b',
    onBrand: '#ffffff',
    danger: '#9b3425',
    onDanger: '#ffffff',
    viewerInk: '#fff4bc',
    overlay: 'rgb(48 53 21 / 55%)',
    imageOverlay: 'rgb(48 53 21 / 96%)',
  },
  cherry: {
    name: 'Cherry',
    scheme: 'light',
    paper: '#ffe6ea',
    surface: '#fff3f5',
    ink: '#482332',
    muted: '#79505d',
    line: '#e4bcc6',
    controlLine: '#a36678',
    hover: '#f5d3dd',
    detail: '#a72043',
    brand: '#a72043',
    brandHover: '#871936',
    onBrand: '#ffffff',
    danger: '#942d14',
    onDanger: '#ffffff',
    viewerInk: '#ffe6ea',
    overlay: 'rgb(72 35 50 / 55%)',
    imageOverlay: 'rgb(72 35 50 / 96%)',
  },
  'after-hours': {
    name: 'After hours',
    scheme: 'dark',
    paper: '#202544',
    surface: '#292f50',
    ink: '#f4f4ff',
    muted: '#bac0da',
    line: '#444b70',
    controlLine: '#858eb8',
    hover: '#303759',
    detail: '#b9c4ff',
    brand: '#b9c4ff',
    brandHover: '#d2d9ff',
    onBrand: '#202544',
    danger: '#ffb4bc',
    onDanger: '#3b1520',
    viewerInk: '#b9c4ff',
    overlay: 'rgb(12 14 29 / 70%)',
    imageOverlay: 'rgb(12 14 29 / 96%)',
  },
  wine: {
    name: 'Wine',
    scheme: 'dark',
    paper: '#351d2b',
    surface: '#432635',
    ink: '#fff0f5',
    muted: '#d9b7c6',
    line: '#624051',
    controlLine: '#b1879a',
    hover: '#482c3b',
    detail: '#f0b3ca',
    brand: '#f0b3ca',
    brandHover: '#ffd0e1',
    onBrand: '#351d2b',
    danger: '#ffb5a0',
    onDanger: '#411b12',
    viewerInk: '#f0b3ca',
    overlay: 'rgb(26 12 21 / 70%)',
    imageOverlay: 'rgb(26 12 21 / 96%)',
  },
  evergreen: {
    name: 'Evergreen',
    scheme: 'dark',
    paper: '#162e28',
    surface: '#203b32',
    ink: '#f1f7ed',
    muted: '#b5cbbf',
    line: '#3e5a4f',
    controlLine: '#7fa795',
    hover: '#254238',
    detail: '#b6d7ac',
    brand: '#b6d7ac',
    brandHover: '#cee8c6',
    onBrand: '#162e28',
    danger: '#ffb9aa',
    onDanger: '#3b1c16',
    viewerInk: '#b6d7ac',
    overlay: 'rgb(9 23 18 / 70%)',
    imageOverlay: 'rgb(9 23 18 / 96%)',
  },
  candlelight: {
    name: 'Candlelight',
    scheme: 'dark',
    paper: '#33211e',
    surface: '#422c26',
    ink: '#fff2e8',
    muted: '#d4bcb0',
    line: '#624a40',
    controlLine: '#b0907d',
    hover: '#49322c',
    detail: '#f3be94',
    brand: '#f3be94',
    brandHover: '#ffd6b5',
    onBrand: '#33211e',
    danger: '#ffb4b9',
    onDanger: '#401a20',
    viewerInk: '#f3be94',
    overlay: 'rgb(25 14 11 / 70%)',
    imageOverlay: 'rgb(25 14 11 / 96%)',
  },
};

const sourceSans = "'Source Sans 3', system-ui, sans-serif";
export const pairings: Record<
  FontPairing,
  {
    name: string;
    heading: string;
    headingWeight: number;
    wordmark: string;
    wordmarkWeight: number;
    body: string;
  }
> = {
  original: {
    name: 'Original',
    heading: sourceSans,
    headingWeight: 600,
    wordmark: "'Caveat', cursive",
    wordmarkWeight: 700,
    body: sourceSans,
  },
  handwritten: {
    name: 'Handwritten',
    heading: "'Caveat', cursive",
    headingWeight: 700,
    wordmark: "'Caveat', cursive",
    wordmarkWeight: 700,
    body: sourceSans,
  },
  classic: {
    name: 'Classic',
    heading: "'Fraunces', Georgia, serif",
    headingWeight: 700,
    wordmark: "'Fraunces', Georgia, serif",
    wordmarkWeight: 700,
    body: sourceSans,
  },
  'bungee-shade': {
    name: 'Bungee Shade',
    heading: "'Bungee Shade', sans-serif",
    headingWeight: 400,
    wordmark: "'Bungee Shade', sans-serif",
    wordmarkWeight: 400,
    body: sourceSans,
  },
  monoton: {
    name: 'Monoton',
    heading: "'Monoton', sans-serif",
    headingWeight: 400,
    wordmark: "'Monoton', sans-serif",
    wordmarkWeight: 400,
    body: sourceSans,
  },
  'fascinate-inline': {
    name: 'Fascinate Inline',
    heading: "'Fascinate Inline', sans-serif",
    headingWeight: 400,
    wordmark: "'Fascinate Inline', sans-serif",
    wordmarkWeight: 400,
    body: sourceSans,
  },
  'rubik-wet-paint': {
    name: 'Rubik Wet Paint',
    heading: "'Rubik Wet Paint', sans-serif",
    headingWeight: 400,
    wordmark: "'Rubik Wet Paint', sans-serif",
    wordmarkWeight: 400,
    body: sourceSans,
  },
};
