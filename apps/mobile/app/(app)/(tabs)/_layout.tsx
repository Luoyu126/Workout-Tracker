import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useI18n } from "@/lib/i18n/I18nProvider";
import { colors } from "@/theme/colors";

export default function TabsLayout() {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const bottomPadding = insets.bottom + 12;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.subtle,
        tabBarStyle: [styles.tabBar, { height: 56 + bottomPadding, paddingBottom: bottomPadding }],
        tabBarLabelStyle: styles.tabLabel,
        sceneStyle: { backgroundColor: colors.background }
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t("tabs.home"),
          tabBarIcon: ({ color, size }) => <Ionicons color={color} name="speedometer-outline" size={size} />
        }}
      />
      <Tabs.Screen
        name="events"
        options={{
          title: t("tabs.events"),
          tabBarIcon: ({ color, size }) => <Ionicons color={color} name="calendar-outline" size={size} />
        }}
      />
      <Tabs.Screen
        name="inbox"
        options={{
          title: t("tabs.inbox"),
          tabBarIcon: ({ color, size }) => <Ionicons color={color} name="file-tray-outline" size={size} />
        }}
      />
      <Tabs.Screen
        name="store"
        options={{
          title: t("tabs.store"),
          tabBarIcon: ({ color, size }) => <Ionicons color={color} name="bag-handle-outline" size={size} />
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t("tabs.profile"),
          tabBarIcon: ({ color, size }) => <Ionicons color={color} name="person-outline" size={size} />
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: colors.tabBar,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    paddingTop: 6
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: "700"
  }
});
