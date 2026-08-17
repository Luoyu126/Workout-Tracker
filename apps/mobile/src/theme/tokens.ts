export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  pill: 999
} as const;

export const typography = {
  title: { fontSize: 28, fontWeight: "800" as const, lineHeight: 34 },
  titleSm: { fontSize: 22, fontWeight: "800" as const, lineHeight: 28 },
  section: { fontSize: 16, fontWeight: "700" as const, lineHeight: 22 },
  body: { fontSize: 15, fontWeight: "500" as const, lineHeight: 21 },
  bodyStrong: { fontSize: 15, fontWeight: "700" as const, lineHeight: 21 },
  caption: { fontSize: 13, fontWeight: "500" as const, lineHeight: 18 },
  metric: { fontSize: 28, fontWeight: "800" as const, lineHeight: 34 },
  button: { fontSize: 16, fontWeight: "800" as const, lineHeight: 20 }
} as const;

export const hitSlop = { top: 8, right: 8, bottom: 8, left: 8 } as const;
