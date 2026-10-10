/** TypeScript mirror of CSS design tokens in app/globals.css */

const tokens = {
  surface: {
    base: "oklch(0.155 0.022 262)",
    raised: "oklch(0.195 0.024 262)",
    overlay: "oklch(0.235 0.026 262)",
    inset: "oklch(0.13 0.02 262)",
  },
  border: {
    default: "oklch(0.42 0.03 262 / 0.35)",
    subtle: "oklch(0.38 0.03 262 / 0.20)",
    strong: "oklch(0.48 0.03 262 / 0.45)",
  },
  text: {
    primary: "oklch(0.96 0.008 255)",
    secondary: "oklch(0.74 0.02 258)",
    tertiary: "oklch(0.57 0.025 260)",
  },
  accent: {
    DEFAULT: "oklch(0.58 0.19 262)",
    hover: "oklch(0.64 0.18 262)",
    muted: "oklch(0.58 0.19 262 / 0.12)",
    foreground: "oklch(0.99 0.004 255)",
    ring: "oklch(0.58 0.19 262 / 0.35)",
    text: "oklch(0.8 0.1 258)",
  },
  signal: {
    assistant: "oklch(0.8 0.15 78)",
    ask: "oklch(0.65 0.12 240)",
    notes: "oklch(0.6 0.02 260)",
  },
  semantic: {
    destructive: "oklch(0.65 0.18 25)",
    destructiveMuted: "oklch(0.65 0.18 25 / 0.12)",
    success: "oklch(0.68 0.14 155)",
    warning: "oklch(0.75 0.14 85)",
    info: "oklch(0.65 0.12 240)",
  },
  shadow: "oklch(0 0 0 / 0.35)",
  radius: {
    sm: "6px",
    md: "8px",
    lg: "10px",
  },
  font: {
    sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
  },
} as const;

/** Legacy auth token mapping for gradual migration */
export const authTokens = {
  pageBg: "oklch(0.155 0.022 262 / 0.92)",
  cardBg: "oklch(0.195 0.024 262)",
  cardBorder: "oklch(0.38 0.03 262 / 0.20)",
  hairline: "oklch(0.38 0.03 262 / 0.20)",
  hairlineSoft: "oklch(0.38 0.03 262 / 0.12)",
  hairlineStrong: "oklch(0.42 0.03 262 / 0.35)",
  inputBg: "oklch(0.13 0.02 262)",
  surfaceSoft: "oklch(0.235 0.026 262 / 0.5)",
  surfaceMid: "oklch(0.175 0.023 262)",
  ink: tokens.text.primary,
  charcoal: tokens.text.primary,
  slate: tokens.text.secondary,
  steel: tokens.text.tertiary,
  stone: "oklch(0.5 0.025 262)",
  muted: tokens.text.tertiary,
  accent: tokens.accent.DEFAULT,
  accentHover: tokens.accent.hover,
  accentSoft: tokens.accent.muted,
  accentRing: tokens.accent.ring,
  accentBorder: "oklch(0.58 0.19 262 / 0.30)",
  accentText: tokens.accent.text,
  sky: tokens.semantic.info,
  skySoft: "oklch(0.65 0.12 240 / 0.12)",
  skyBorder: "oklch(0.65 0.12 240 / 0.30)",
  semanticError: tokens.semantic.destructive,
  semanticErrorSoft: tokens.semantic.destructiveMuted,
  semanticSuccess: tokens.semantic.success,
  errSoft: tokens.semantic.destructiveMuted,
  errBorder: "oklch(0.65 0.18 25 / 0.30)",
  err: tokens.semantic.destructive,
} as const;
