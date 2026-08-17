import { Pressable, ScrollView, StyleSheet, Text } from "react-native";

import { colors } from "@/theme/colors";
import { radius, spacing, typography } from "@/theme/tokens";

export type SegmentOption<T extends string | boolean | null> = {
  value: T;
  label: string;
};

type SegmentedControlProps<T extends string | boolean | null> = {
  options: Array<SegmentOption<T>>;
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
};

export function SegmentedControl<T extends string | boolean | null>({
  options,
  value,
  onChange,
  disabled = false
}: SegmentedControlProps<T>) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            accessibilityRole="button"
            disabled={disabled}
            key={String(option.value)}
            onPress={() => onChange(option.value)}
            style={[styles.chip, active && styles.activeChip, disabled && styles.disabled]}
          >
            <Text style={[styles.label, active && styles.activeLabel]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: spacing.sm
  },
  chip: {
    backgroundColor: colors.surfaceElevated,
    borderColor: colors.border,
    borderRadius: radius.pill,
    borderWidth: 1,
    minHeight: 36,
    justifyContent: "center",
    paddingHorizontal: 14
  },
  activeChip: {
    backgroundColor: colors.accent,
    borderColor: colors.accent
  },
  label: {
    color: colors.muted,
    ...typography.caption,
    fontWeight: "700"
  },
  activeLabel: {
    color: colors.accentText
  },
  disabled: {
    opacity: 0.55
  }
});
