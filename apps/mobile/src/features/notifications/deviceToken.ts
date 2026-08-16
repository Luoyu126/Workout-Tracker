import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import type { DevicePlatform } from "./api";

export type ExpoPushTokenRegistrationResult =
  | {
      status: "registered";
      token: string;
      platform: DevicePlatform;
    }
  | {
      status: "denied" | "unsupported";
    };

export function getDefaultDevicePlatform(): DevicePlatform {
  return Platform.OS === "android" ? "android" : "ios";
}

export function normalizeExpoPushToken(value: string) {
  const normalizedValue = value.trim();
  return /^ExponentPushToken\[[A-Za-z0-9_-]+\]$/.test(normalizedValue) ? normalizedValue : null;
}

function normalizeOptionalProjectId(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export function getExpoProjectId() {
  return (
    normalizeOptionalProjectId(Constants.easConfig?.projectId) ??
    normalizeOptionalProjectId(Constants.expoConfig?.extra?.eas?.projectId)
  );
}

async function getNormalizedExpoPushToken(projectId?: string) {
  try {
    const resolvedProjectId = normalizeOptionalProjectId(projectId) ?? getExpoProjectId();
    const tokenResponse = await Notifications.getExpoPushTokenAsync(
      resolvedProjectId ? { projectId: resolvedProjectId } : undefined
    );
    return normalizeExpoPushToken(tokenResponse.data);
  } catch {
    return null;
  }
}

export async function requestExpoPushTokenAsync(projectId?: string): Promise<ExpoPushTokenRegistrationResult> {
  if (Platform.OS === "web") {
    return { status: "unsupported" };
  }

  let finalStatus: string;
  try {
    const existingPermissions = await Notifications.getPermissionsAsync();
    finalStatus = existingPermissions.status;

    if (finalStatus !== "granted") {
      const requestedPermissions = await Notifications.requestPermissionsAsync();
      finalStatus = requestedPermissions.status;
    }
  } catch {
    return { status: "unsupported" };
  }

  if (finalStatus !== "granted") {
    return { status: "denied" };
  }

  const token = await getNormalizedExpoPushToken(projectId);

  if (!token) {
    return { status: "unsupported" };
  }

  return {
    status: "registered",
    token,
    platform: getDefaultDevicePlatform()
  };
}

export async function refreshExpoPushTokenIfGrantedAsync(
  projectId?: string
): Promise<ExpoPushTokenRegistrationResult | { status: "skipped" }> {
  if (Platform.OS === "web") {
    return { status: "unsupported" };
  }

  let existingPermissions: Notifications.NotificationPermissionsStatus;
  try {
    existingPermissions = await Notifications.getPermissionsAsync();
  } catch {
    return { status: "unsupported" };
  }

  if (existingPermissions.status !== "granted") {
    return { status: "skipped" };
  }

  const token = await getNormalizedExpoPushToken(projectId);

  if (!token) {
    return { status: "unsupported" };
  }

  return {
    status: "registered",
    token,
    platform: getDefaultDevicePlatform()
  };
}
