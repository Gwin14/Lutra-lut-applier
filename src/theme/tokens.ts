/**
 * Design tokens. Rules (enforced by review, not by taste):
 * - One accent: amber "tungsten". Spent on primary actions, active state, progress.
 *   Text on the accent fill is always `onAccent` (near-black) in both themes.
 * - One grey family: iOS system greys (cool). No warm greys anywhere.
 * - Shape lock: actions/chips are pills, cards & sheets 16, media 10, inputs 10.
 * - Spacing base unit 4.
 * - The editor always renders on the neutral `grade` surfaces (dark), because a
 *   colour decision must be made against a neutral dark surround.
 */
import type { TextStyle } from 'react-native';

export type Palette = {
  bg: string;
  bgGrouped: string;
  surface: string;
  surfaceRaised: string;
  fill: string;
  fillStrong: string;
  separator: string;
  label: string;
  labelSecondary: string;
  labelTertiary: string;
  accent: string;
  accentText: string;
  onAccent: string;
  accentSoft: string;
  danger: string;
  success: string;
  overlay: string;
};

export const light: Palette = {
  bg: '#FFFFFF',
  bgGrouped: '#F2F2F7',
  surface: '#FFFFFF',
  surfaceRaised: '#FFFFFF',
  fill: 'rgba(120,120,128,0.12)',
  fillStrong: 'rgba(120,120,128,0.2)',
  separator: 'rgba(60,60,67,0.18)',
  label: '#000000',
  labelSecondary: 'rgba(60,60,67,0.64)',
  labelTertiary: 'rgba(60,60,67,0.36)',
  accent: '#F5A623',
  accentText: '#9A5B00',
  onAccent: '#1A1206',
  accentSoft: 'rgba(245,166,35,0.16)',
  danger: '#D70015',
  success: '#248A3D',
  overlay: 'rgba(0,0,0,0.4)',
};

export const dark: Palette = {
  bg: '#000000',
  bgGrouped: '#000000',
  surface: '#1C1C1E',
  surfaceRaised: '#2C2C2E',
  fill: 'rgba(120,120,128,0.24)',
  fillStrong: 'rgba(120,120,128,0.36)',
  separator: 'rgba(84,84,88,0.6)',
  label: '#FFFFFF',
  labelSecondary: 'rgba(235,235,245,0.64)',
  labelTertiary: 'rgba(235,235,245,0.34)',
  accent: '#FFB23F',
  accentText: '#FFBE5C',
  onAccent: '#1A1206',
  accentSoft: 'rgba(255,178,63,0.18)',
  danger: '#FF453A',
  success: '#30D158',
  overlay: 'rgba(0,0,0,0.5)',
};

/** Neutral dark grading surround used by the editor in both themes. */
export const grade = {
  ...dark,
  bg: '#0B0B0C',
  bgGrouped: '#0B0B0C',
  surface: '#161618',
  surfaceRaised: '#222225',
  viewer: '#050506',
};

export const space = { xs: 4, s: 8, m: 12, l: 16, xl: 20, xxl: 24, xxxl: 32 } as const;

export const radius = { pill: 999, card: 16, media: 10, input: 10 } as const;

type Ramp = Record<
  'largeTitle' | 'title1' | 'title2' | 'title3' | 'headline' | 'body' | 'callout' | 'subhead' | 'footnote' | 'caption1' | 'caption2',
  TextStyle
>;

export const type: Ramp = {
  largeTitle: { fontSize: 34, lineHeight: 41, fontWeight: '700', letterSpacing: 0.37 },
  title1: { fontSize: 28, lineHeight: 34, fontWeight: '700', letterSpacing: 0.36 },
  title2: { fontSize: 22, lineHeight: 28, fontWeight: '700', letterSpacing: 0.35 },
  title3: { fontSize: 20, lineHeight: 25, fontWeight: '600', letterSpacing: 0.38 },
  headline: { fontSize: 17, lineHeight: 22, fontWeight: '600', letterSpacing: -0.41 },
  body: { fontSize: 17, lineHeight: 22, fontWeight: '400', letterSpacing: -0.41 },
  callout: { fontSize: 16, lineHeight: 21, fontWeight: '400', letterSpacing: -0.32 },
  subhead: { fontSize: 15, lineHeight: 20, fontWeight: '400', letterSpacing: -0.24 },
  footnote: { fontSize: 13, lineHeight: 18, fontWeight: '400', letterSpacing: -0.08 },
  caption1: { fontSize: 12, lineHeight: 16, fontWeight: '400', letterSpacing: 0 },
  caption2: { fontSize: 11, lineHeight: 13, fontWeight: '400', letterSpacing: 0.07 },
};

/** One elevation system: a single soft shadow for floating elements. */
export const elevation = {
  float: '0 8px 24px rgba(0,0,0,0.18)',
  floatDark: '0 8px 24px rgba(0,0,0,0.5)',
} as const;

export const motion = {
  /** Strong ease-out for narrative motion. */
  easeOut: [0.23, 1, 0.32, 1] as const,
  settle: { duration: 400, dampingRatio: 1 },
  sheet: { duration: 300, dampingRatio: 0.8 },
  press: 120,
} as const;
