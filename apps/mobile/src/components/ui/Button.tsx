import { Pressable, StyleSheet, Text, type PressableProps, type StyleProp, type ViewStyle } from "react-native";

import { colors } from "@/theme/colors";
import { radius, typography } from "@/theme/tokens";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "dangerOutline";

type ButtonProps = PressableProps & {
  label: string;
  variant?: ButtonVariant;
  style?: StyleProp<ViewStyle>;
};

export function Button({ label, variant = "primary", disabled, style, ...props }: ButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      style={[styles.base, styles[variant], disabled && styles.disabled, style]}
      {...props}
    >
      <Text style={[styles.label, styles[`${variant}Label` as const]]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: "center",
    borderRadius: radius.md,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: 16
  },
  primary: {
    backgroundColor: colors.accent
  },
  secondary: {
    backgroundColor: colors.surfaceElevated,
    borderColor: colors.border,
    borderWidth: 1
  },
  ghost: {
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.border,
    borderWidth: 1
  },
  danger: {
    backgroundColor: colors.dangerMuted
  },
  dangerOutline: {
    backgroundColor: "transparent",
    borderColor: colors.danger,
    borderWidth: 1
  },
  label: {
    ...typography.button
  },
  primaryLabel: {
    color: colors.accentText
  },
  secondaryLabel: {
    color: colors.text
  },
  ghostLabel: {
    color: colors.text
  },
  dangerLabel: {
    color: colors.danger
  },
  dangerOutlineLabel: {
    color: colors.danger
  },
  disabled: {
    opacity: 0.55
  }
});
