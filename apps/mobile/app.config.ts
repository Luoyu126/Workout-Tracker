import type { ExpoConfig } from "expo/config";

const config: ExpoConfig = {
  name: "Workout Tracker",
  slug: "workout-tracker",
  scheme: "workouttracker",
  version: "0.1.0",
  orientation: "portrait",
  userInterfaceStyle: "dark",
  ios: {
    bundleIdentifier: "com.chenyy.workouttracker",
    supportsTablet: false
  },
  android: {
    package: "com.chenyy.workouttracker",
    adaptiveIcon: {
      backgroundColor: "#101114"
    }
  },
  plugins: ["expo-router", "expo-localization", "expo-secure-store", "expo-notifications"],
  extra: {
    eas: {
      projectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID
    }
  }
};

export default config;
