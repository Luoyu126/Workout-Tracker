import { StyleSheet } from "react-native";

import { colors } from "@/theme/colors";
import { radius, spacing, typography } from "@/theme/tokens";

/** Shared page styles for secondary screens during UI redesign. */
export const ui = StyleSheet.create({
  container: {
    gap: spacing.lg,
    padding: spacing.xl,
    paddingBottom: spacing.xxxl,
    paddingTop: spacing.lg
  },
  title: {
    color: colors.text,
    ...typography.title
  },
  sectionTitle: {
    color: colors.text,
    marginTop: spacing.sm,
    ...typography.titleSm
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.lg
  },
  cardTitle: {
    color: colors.text,
    ...typography.section
  },
  muted: {
    color: colors.muted,
    ...typography.caption
  },
  input: {
    backgroundColor: colors.surfaceElevated,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.text,
    fontSize: 16,
    minHeight: 48,
    paddingHorizontal: 14
  },
  multilineInput: {
    minHeight: 84,
    paddingTop: 12,
    textAlignVertical: "top"
  },
  button: {
    alignItems: "center",
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: 16
  },
  buttonText: {
    color: colors.accentText,
    ...typography.button
  },
  secondaryButton: {
    alignItems: "center",
    backgroundColor: colors.surfaceElevated,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: 16
  },
  secondaryText: {
    color: colors.text,
    ...typography.bodyStrong
  },
  dangerButton: {
    alignItems: "center",
    backgroundColor: colors.dangerMuted,
    borderColor: colors.danger,
    borderRadius: radius.md,
    borderWidth: 1,
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: 16
  },
  pillButton: {
    alignItems: "center",
    backgroundColor: colors.surfaceElevated,
    borderColor: colors.border,
    borderRadius: radius.pill,
    borderWidth: 1,
    minHeight: 40,
    justifyContent: "center",
    paddingHorizontal: 14
  },
  activePill: {
    backgroundColor: colors.accent,
    borderColor: colors.accent
  },
  activeButton: {
    backgroundColor: colors.accent
  },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm
  },
  rowInput: {
    flex: 1
  },
  smallButton: {
    alignItems: "center",
    backgroundColor: colors.surfaceElevated,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flex: 1,
    minHeight: 42,
    justifyContent: "center",
    minWidth: "47%",
    paddingHorizontal: 10
  },
  disabled: {
    opacity: 0.55
  }
});
