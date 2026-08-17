import { StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/ui/Button";
import { colors } from "@/theme/colors";
import { spacing, typography } from "@/theme/tokens";

type EmptyStateProps = {
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
};

export function EmptyState({ title, description, actionLabel, onAction }: EmptyStateProps) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{title}</Text>
      {description ? <Text style={styles.description}>{description}</Text> : null}
      {actionLabel && onAction ? <Button label={actionLabel} onPress={onAction} style={styles.button} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.xl
  },
  title: {
    color: colors.text,
    textAlign: "center",
    ...typography.section
  },
  description: {
    color: colors.muted,
    textAlign: "center",
    ...typography.caption
  },
  button: {
    alignSelf: "stretch",
    marginTop: spacing.sm
  }
});
