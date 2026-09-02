import * as Notifications from "expo-notifications";
import { Stack, useRouter } from "expo-router";
import { useEffect, useRef } from "react";
import { ActivityIndicator, AppState, KeyboardAvoidingView, Platform, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { registerDeviceToken } from "@/features/notifications/api";
import { refreshExpoPushTokenIfGrantedAsync } from "@/features/notifications/deviceToken";
import { getNotificationRoute } from "@/features/notifications/navigation";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { installWebAlert } from "@/lib/webAlert";
import { AppProviders } from "@/providers/AppProviders";
import { useAuth, type AuthStatus } from "@/providers/AuthProvider";
import { colors } from "@/theme/colors";
import { spacing, typography } from "@/theme/tokens";

installWebAlert();

function AppNavigator() {
  const router = useRouter();
  const { t } = useI18n();
  const { status } = useAuth();
  const statusRef = useRef<AuthStatus>(status);
  const pendingNotificationRef = useRef<Notifications.NotificationResponse | null>(null);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    function handleNotificationResponse(response: Notifications.NotificationResponse) {
      if (statusRef.current === "ready") {
        const route = getNotificationRoute(response.notification.request.content.data);
        if (route) {
          router.push(route);
        }
      } else if (statusRef.current === "checking") {
        pendingNotificationRef.current = response;
      } else {
        pendingNotificationRef.current = null;
      }
      void Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
    }

    let subscription: Notifications.EventSubscription | undefined;
    try {
      subscription = Notifications.addNotificationResponseReceivedListener(handleNotificationResponse);
      void Notifications.getLastNotificationResponseAsync()
        .then((response) => {
          if (response) {
            handleNotificationResponse(response);
          }
        })
        .catch(() => undefined);
    } catch {
      // Notification deep-link handling is best-effort and must not block app startup.
    }

    return () => {
      subscription?.remove();
    };
  }, [router]);

  useEffect(() => {
    const pendingResponse = pendingNotificationRef.current;
    if (status === "ready" && pendingResponse) {
      pendingNotificationRef.current = null;
      const route = getNotificationRoute(pendingResponse.notification.request.content.data);
      if (route) {
        router.push(route);
      }
    } else if (status !== "checking") {
      pendingNotificationRef.current = null;
    }
  }, [router, status]);

  useEffect(() => {
    if (status !== "ready") {
      return;
    }

    async function refreshRegisteredExpoPushToken() {
      try {
        const registration = await refreshExpoPushTokenIfGrantedAsync();
        if (registration.status === "registered") {
          await registerDeviceToken(registration.token, registration.platform);
        }
      } catch {
        // Push token refresh is best-effort and must not block app startup.
      }
    }

    void refreshRegisteredExpoPushToken();
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        void refreshRegisteredExpoPushToken();
      }
    });

    return () => {
      subscription.remove();
    };
  }, [status]);

  if (status === "checking") {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator color={colors.accent} size="large" />
        <Text style={styles.loadingText}>{t("common.loading")}</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={styles.keyboardAvoidingContainer}
    >
      <Stack screenOptions={{ contentStyle: { backgroundColor: colors.background } }}>
        <Stack.Protected guard={status !== "ready"}>
          <Stack.Screen name="login" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Protected guard={status === "ready"}>
          <Stack.Screen name="(app)" options={{ headerShown: false }} />
        </Stack.Protected>
      </Stack>
    </KeyboardAvoidingView>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AppProviders>
        <AppNavigator />
      </AppProviders>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  keyboardAvoidingContainer: {
    flex: 1
  },
  loadingContainer: {
    alignItems: "center",
    backgroundColor: colors.background,
    flex: 1,
    gap: spacing.md,
    justifyContent: "center"
  },
  loadingText: {
    color: colors.muted,
    ...typography.body
  }
});
