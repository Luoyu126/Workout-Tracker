import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { colors } from "@/theme/colors";
import { radius, typography } from "@/theme/tokens";

type BadgeTone = "accent" | "gold" | "warning" | "danger" | "info" | "purple" | "muted";

type BadgeProps = {
  label: string;
  tone?: BadgeTone;
  style?: StyleProp<ViewStyle>;
};

const toneStyles: Record<BadgeTone, { bg: string; fg: string }> = {
  accent: { bg: colors.accentMuted, fg: colors.accentSoft },
  gold: { bg: colors.goldMuted, fg: colors.gold },
  warning: { bg: colors.warningMuted, fg: colors.warning },
  danger: { bg: colors.dangerMuted, fg: colors.danger },
  info: { bg: colors.infoMuted, fg: colors.info },
  purple: { bg: colors.purpleMuted, fg: colors.purple },
  muted: { bg: colors.surfaceElevated, fg: colors.muted }
};

export function Badge({ label, tone = "accent", style }: BadgeProps) {
  const palette = toneStyles[tone];
  return (
    <View style={[styles.badge, { backgroundColor: palette.bg }, style]}>
      <Text style={[styles.text, { color: palette.fg }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: "flex-start",
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4
  },
  text: {
    ...typography.caption,
    fontWeight: "700"
  }
});
