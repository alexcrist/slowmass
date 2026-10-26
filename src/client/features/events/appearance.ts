import type { ColorTheme, FontPairing } from '../../../shared/event-appearance';

type Palette = {
  name: string;
  scheme: 'light' | 'dark';
  paper: string;
  // Accent at the canvas's left and right edges, fading into paper: darker
  // than paper on light palettes, lighter on evening ones.
  edge: string;
  // Navigation bar fill: darker than paper, so the bars recede behind content.
  nav: string;
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
    edge: '#ffffff',
    nav: '#ffffff',
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
    paper: '#d4eaff',
    edge: '#6aaeff',
    nav: '#b5d8ff',
    surface: '#e6f3ff',
    ink: '#0d2250',
    muted: '#2f4c78',
    line: '#a2c6ef',
    controlLine: '#4c6fa3',
    hover: '#bedcff',
    detail: '#1740c8',
    brand: '#1740c8',
    brandHover: '#1233a0',
    onBrand: '#ffffff',
    danger: '#a12a40',
    onDanger: '#ffffff',
    viewerInk: '#d4eaff',
    overlay: 'rgb(13 34 80 / 55%)',
    imageOverlay: 'rgb(13 34 80 / 96%)',
  },
  lilac: {
    name: 'Lilac',
    scheme: 'light',
    paper: '#e8d9ff',
    edge: '#b28af4',
    nav: '#d4bcfa',
    surface: '#f3eaff',
    ink: '#2b1150',
    muted: '#5a4080',
    line: '#c8afec',
    controlLine: '#8260b6',
    hover: '#d9c3fb',
    detail: '#6420c0',
    brand: '#6420c0',
    brandHover: '#4f189a',
    onBrand: '#ffffff',
    danger: '#9a2947',
    onDanger: '#ffffff',
    viewerInk: '#e8d9ff',
    overlay: 'rgb(43 17 80 / 55%)',
    imageOverlay: 'rgb(43 17 80 / 96%)',
  },
  citrus: {
    name: 'Citrus',
    scheme: 'light',
    paper: '#fff094',
    edge: '#ffc433',
    nav: '#fbdc5c',
    surface: '#fff7c4',
    ink: '#2b2705',
    muted: '#585116',
    line: '#e2cf72',
    controlLine: '#81752a',
    hover: '#fbe270',
    detail: '#9a3412',
    brand: '#9a3412',
    brandHover: '#7c2a0e',
    onBrand: '#ffffff',
    danger: '#8f2f1f',
    onDanger: '#ffffff',
    viewerInk: '#fff094',
    overlay: 'rgb(43 39 5 / 55%)',
    imageOverlay: 'rgb(43 39 5 / 96%)',
  },
  cherry: {
    name: 'Cherry',
    scheme: 'light',
    paper: '#ffd6e0',
    edge: '#ff7ba3',
    nav: '#ffb8ca',
    surface: '#ffeaf0',
    ink: '#45091f',
    muted: '#77304a',
    line: '#f1adc0',
    controlLine: '#b04f6e',
    hover: '#ffc3d2',
    detail: '#a50e36',
    brand: '#a50e36',
    brandHover: '#840b2b',
    onBrand: '#ffffff',
    danger: '#942d14',
    onDanger: '#ffffff',
    viewerInk: '#ffd6e0',
    overlay: 'rgb(69 9 31 / 55%)',
    imageOverlay: 'rgb(69 9 31 / 96%)',
  },
  'after-hours': {
    name: 'After hours',
    scheme: 'dark',
    paper: '#0e1342',
    edge: '#2c44c4',
    nav: '#070a26',
    surface: '#171d57',
    ink: '#f4f5ff',
    muted: '#b4bcf0',
    line: '#2d3579',
    controlLine: '#7c88d8',
    hover: '#1e2563',
    detail: '#aab9ff',
    brand: '#aab9ff',
    brandHover: '#ccd5ff',
    onBrand: '#0e1342',
    danger: '#ffb4bc',
    onDanger: '#3b1520',
    viewerInk: '#aab9ff',
    overlay: 'rgb(5 7 24 / 70%)',
    imageOverlay: 'rgb(5 7 24 / 96%)',
  },
  wine: {
    name: 'Wine',
    scheme: 'dark',
    paper: '#2c0a22',
    edge: '#8a1d5c',
    nav: '#170412',
    surface: '#3a1030',
    ink: '#fff0f7',
    muted: '#e0afc8',
    line: '#5a2048',
    controlLine: '#b9759b',
    hover: '#461539',
    detail: '#ffa6cf',
    brand: '#ffa6cf',
    brandHover: '#ffc9e2',
    onBrand: '#2c0a22',
    danger: '#ffb5a0',
    onDanger: '#411b12',
    viewerInk: '#ffa6cf',
    overlay: 'rgb(20 4 15 / 70%)',
    imageOverlay: 'rgb(20 4 15 / 96%)',
  },
  evergreen: {
    name: 'Evergreen',
    scheme: 'dark',
    paper: '#062a20',
    edge: '#117450',
    nav: '#021510',
    surface: '#0b3529',
    ink: '#effaf2',
    muted: '#a8d4bf',
    line: '#1d5242',
    controlLine: '#6fb497',
    hover: '#0f4031',
    detail: '#9ef0c3',
    brand: '#9ef0c3',
    brandHover: '#c4f8da',
    onBrand: '#062a20',
    danger: '#ffb9aa',
    onDanger: '#3b1c16',
    viewerInk: '#9ef0c3',
    overlay: 'rgb(2 18 13 / 70%)',
    imageOverlay: 'rgb(2 18 13 / 96%)',
  },
  candlelight: {
    name: 'Candlelight',
    scheme: 'dark',
    paper: '#2a1308',
    edge: '#a0430f',
    nav: '#160902',
    surface: '#371a0c',
    ink: '#fff3e6',
    muted: '#e3bea0',
    line: '#5c3018',
    controlLine: '#c08a63',
    hover: '#42200f',
    detail: '#ffbf7a',
    brand: '#ffbf7a',
    brandHover: '#ffd6a8',
    onBrand: '#2a1308',
    danger: '#ffb4b9',
    onDanger: '#401a20',
    viewerInk: '#ffbf7a',
    overlay: 'rgb(22 9 2 / 70%)',
    imageOverlay: 'rgb(22 9 2 / 96%)',
  },
};

const sourceSans = "'Source Sans 3', system-ui, sans-serif";
export const pairings: Record<
  FontPairing,
  {
    name: string;
    heading: string;
    headingWeight: number;
  }
> = {
  original: {
    name: 'Original',
    heading: sourceSans,
    headingWeight: 600,
  },
  handwritten: {
    name: 'Handwritten',
    heading: "'Caveat', cursive",
    headingWeight: 700,
  },
  classic: {
    name: 'Classic',
    heading: "'Fraunces', Georgia, serif",
    headingWeight: 700,
  },
  'bungee-shade': {
    name: 'Bungee Shade',
    heading: "'Bungee Shade', sans-serif",
    headingWeight: 400,
  },
  monoton: {
    name: 'Monoton',
    heading: "'Monoton', sans-serif",
    headingWeight: 400,
  },
  'fascinate-inline': {
    name: 'Fascinate Inline',
    heading: "'Fascinate Inline', sans-serif",
    headingWeight: 400,
  },
  'rubik-wet-paint': {
    name: 'Rubik Wet Paint',
    heading: "'Rubik Wet Paint', sans-serif",
    headingWeight: 400,
  },
};
