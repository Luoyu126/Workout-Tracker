import { StyleSheet, View, type StyleProp, type ViewProps, type ViewStyle } from "react-native";

import { colors } from "@/theme/colors";
import { radius, spacing } from "@/theme/tokens";

type CardProps = ViewProps & {
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
  accentBorder?: boolean;
};

export function Card({ style, padded = true, accentBorder = false, children, ...props }: CardProps) {
  return (
    <View
      style={[styles.card, padded && styles.padded, accentBorder && styles.accentBorder, style]}
      {...props}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    overflow: "hidden"
  },
  padded: {
    gap: spacing.sm,
    padding: spacing.lg
  },
  accentBorder: {
    borderColor: colors.accent
  }
});
