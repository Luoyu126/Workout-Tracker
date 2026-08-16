import { Link } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors } from "@/theme/colors";

type ScreenStateProps = {
  isLoading?: boolean;
  loadingLabel: string;
  message?: string | null;
  retryLabel?: string;
  onRetry?: () => void;
  authRequiredLabel?: string;
  signInLabel?: string;
};

export function ScreenState({
  isLoading = false,
  loadingLabel,
  message,
  retryLabel,
  onRetry,
  authRequiredLabel,
  signInLabel
}: ScreenStateProps) {
  if (!isLoading && !message) {
    return null;
  }
  const shouldShowSignIn = Boolean(message && authRequiredLabel && signInLabel && message === authRequiredLabel);

  return (
    <View accessibilityLiveRegion="polite" style={styles.container}>
      {isLoading ? <Text style={styles.loadingText}>{loadingLabel}</Text> : null}
      {message ? <Text style={styles.messageText}>{message}</Text> : null}
      {!isLoading && shouldShowSignIn ? (
        <Link href="/login" asChild>
          <Pressable accessibilityRole="button" style={styles.retryButton}>
            <Text style={styles.retryText}>{signInLabel}</Text>
          </Pressable>
        </Link>
      ) : null}
      {!isLoading && message && retryLabel && onRetry ? (
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
    borderColor: colors.background,
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
    padding: 14
  },
  loadingText: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: "800"
  },
  messageText: {
    color: colors.muted,
    fontSize: 14
  },
  retryButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: colors.background,
    borderRadius: 8,
    minHeight: 40,
    justifyContent: "center",
    paddingHorizontal: 14
  },
  retryText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "800"
  }
});
