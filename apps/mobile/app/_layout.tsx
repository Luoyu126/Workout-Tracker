import * as Notifications from "expo-notifications";
import { Stack, useRouter } from "expo-router";
import { useEffect } from "react";
import { AppState, KeyboardAvoidingView, Platform, StyleSheet } from "react-native";

import { registerDeviceToken } from "@/features/notifications/api";
import { refreshExpoPushTokenIfGrantedAsync } from "@/features/notifications/deviceToken";
import { getNotificationRoute } from "@/features/notifications/navigation";
import { AppProviders } from "@/providers/AppProviders";
import { colors } from "@/theme/colors";

export default function RootLayout() {
  const router = useRouter();

  useEffect(() => {
    function openNotificationRoute(response: Notifications.NotificationResponse) {
      const route = getNotificationRoute(response.notification.request.content.data);
      if (route) {
        router.push(route);
      }
    }

    let subscription: Notifications.EventSubscription | undefined;
    try {
      subscription = Notifications.addNotificationResponseReceivedListener(openNotificationRoute);
      void Notifications.getLastNotificationResponseAsync()
        .then((response) => {
          if (response) {
            openNotificationRoute(response);
            void Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
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
  }, []);

  return (
    <AppProviders>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.keyboardAvoidingContainer}
      >
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.surface },
            headerTintColor: colors.text,
            contentStyle: { backgroundColor: colors.background }
          }}
        />
      </KeyboardAvoidingView>
    </AppProviders>
  );
}

const styles = StyleSheet.create({
  keyboardAvoidingContainer: {
    flex: 1
  }
});
