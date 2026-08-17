import { Link } from "expo-router";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { colors } from "@/theme/colors";
import { radius, spacing, typography } from "@/theme/tokens";

type ScreenStateProps = {
  isLoading?: boolean;
  loadingLabel: string;
  message?: string | null;
  // Success feedback is informational only, so it must never offer a retry action.
  messageTone?: "error" | "success";
  retryLabel?: string;
  onRetry?: () => void;
  authRequiredLabel?: string;
  signInLabel?: string;
};

export function ScreenState({
  isLoading = false,
  loadingLabel,
  message,
  messageTone = "error",
  retryLabel,
  onRetry,
  authRequiredLabel,
  signInLabel
}: ScreenStateProps) {
  if (!isLoading && !message) {
    return null;
  }
  const isSuccess = messageTone === "success";
  const shouldShowSignIn = Boolean(
    !isSuccess && message && authRequiredLabel && signInLabel && message === authRequiredLabel
  );

  return (
    <View accessibilityLiveRegion="polite" style={styles.container}>
      {isLoading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.loadingText}>{loadingLabel}</Text>
        </View>
      ) : null}
      {message ? (
        <Text style={[styles.messageText, isSuccess && styles.successText]}>{message}</Text>
      ) : null}
      {!isLoading && shouldShowSignIn ? (
        <Link href="/login" asChild>
          <Pressable accessibilityRole="button" style={styles.retryButton}>
            <Text style={styles.retryText}>{signInLabel}</Text>
          </Pressable>
        </Link>
      ) : null}
      {!isLoading && !isSuccess && message && retryLabel && onRetry ? (
        <Pressable accessibilityRole="button" onPress={onRetry} style={styles.retryButton}>
          <Text style={styles.retryText}>{retryLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.lg
  },
  loadingRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm
  },
  loadingText: {
    color: colors.accentSoft,
    ...typography.caption,
    fontWeight: "800"
  },
  messageText: {
    color: colors.muted,
    ...typography.body
  },
  successText: {
    color: colors.accentSoft,
    fontWeight: "700"
  },
  retryButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    minHeight: 40,
    justifyContent: "center",
    paddingHorizontal: 14
  },
  retryText: {
    color: colors.accentText,
    fontSize: 14,
    fontWeight: "800"
  }
});
