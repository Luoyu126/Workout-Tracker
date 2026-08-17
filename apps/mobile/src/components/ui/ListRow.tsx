import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors } from "@/theme/colors";
import { radius, spacing, typography } from "@/theme/tokens";

type ListRowProps = {
  title: string;
  subtitle?: string;
  leftIcon?: keyof typeof Ionicons.glyphMap;
  rightText?: string;
  onPress?: () => void;
  disabled?: boolean;
};

export function ListRow({ title, subtitle, leftIcon, rightText, onPress, disabled }: ListRowProps) {
  const content = (
    <View style={[styles.row, disabled && styles.disabled]}>
      {leftIcon ? (
        <View style={styles.iconWrap}>
          <Ionicons color={colors.accentSoft} name={leftIcon} size={18} />
        </View>
      ) : null}
      <View style={styles.textWrap}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {rightText ? <Text style={styles.rightText}>{rightText}</Text> : null}
      {onPress ? <Ionicons color={colors.subtle} name="chevron-forward" size={18} /> : null}
    </View>
  );

  if (!onPress) {
    return content;
  }

  return (
    <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress}>
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.md,
    minHeight: 56,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md
  },
  iconWrap: {
    alignItems: "center",
    backgroundColor: colors.accentMuted,
    borderRadius: radius.md,
    height: 36,
    justifyContent: "center",
    width: 36
  },
  textWrap: {
    flex: 1,
    gap: 2
  },
  title: {
    color: colors.text,
    ...typography.bodyStrong
  },
  subtitle: {
    color: colors.muted,
    ...typography.caption
  },
  rightText: {
    color: colors.accentSoft,
    ...typography.caption,
    fontWeight: "700"
  },
  disabled: {
    opacity: 0.55
  }
});
