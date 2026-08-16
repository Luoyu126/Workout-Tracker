import { beforeEach, describe, expect, test, vi } from "vitest";

const notificationsMock = vi.hoisted(() => ({
  getExpoPushTokenAsync: vi.fn(),
  getPermissionsAsync: vi.fn(),
  requestPermissionsAsync: vi.fn()
}));

const constantsMock = vi.hoisted(() => ({
  easConfig: undefined as { projectId?: string } | undefined,
  expoConfig: undefined as { extra?: { eas?: { projectId?: string } } } | undefined
}));

vi.mock("expo-constants", () => ({
  default: constantsMock
}));

vi.mock("expo-notifications", () => notificationsMock);

vi.mock("react-native", () => ({
  Platform: {
    OS: "android"
  }
}));

describe("device token helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    constantsMock.easConfig = undefined;
    constantsMock.expoConfig = undefined;
  });

  test("normalizes valid Expo push tokens and rejects invalid input", async () => {
    const { normalizeExpoPushToken } = await import("../src/features/notifications/deviceToken");

    expect(normalizeExpoPushToken(" ExponentPushToken[abc_DEF-123] ")).toBe("ExponentPushToken[abc_DEF-123]");
    expect(normalizeExpoPushToken("")).toBeNull();
    expect(normalizeExpoPushToken("abc_DEF-123")).toBeNull();
    expect(normalizeExpoPushToken("ExponentPushToken[]")).toBeNull();
  });

  test("uses the native platform as the default registration platform", async () => {
    const { getDefaultDevicePlatform } = await import("../src/features/notifications/deviceToken");

    expect(getDefaultDevicePlatform()).toBe("android");
  });

  test("requests notification permission and returns the native Expo push token", async () => {
    const { requestExpoPushTokenAsync } = await import("../src/features/notifications/deviceToken");

    notificationsMock.getPermissionsAsync.mockResolvedValueOnce({ status: "undetermined" });
    notificationsMock.requestPermissionsAsync.mockResolvedValueOnce({ status: "granted" });
    notificationsMock.getExpoPushTokenAsync.mockResolvedValueOnce({ data: "ExponentPushToken[native-123]" });

    await expect(requestExpoPushTokenAsync("eas-project-id")).resolves.toEqual({
      status: "registered",
      token: "ExponentPushToken[native-123]",
      platform: "android"
    });
    expect(notificationsMock.getExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: "eas-project-id" });
  });

  test("resolves the Expo project id from native or app config", async () => {
    const { getExpoProjectId } = await import("../src/features/notifications/deviceToken");

    constantsMock.expoConfig = { extra: { eas: { projectId: " app-config-project " } } };
    expect(getExpoProjectId()).toBe("app-config-project");

    constantsMock.easConfig = { projectId: " native-project " };
    expect(getExpoProjectId()).toBe("native-project");
  });

  test("uses configured Expo project id when requesting the native push token", async () => {
    const { requestExpoPushTokenAsync } = await import("../src/features/notifications/deviceToken");

    constantsMock.expoConfig = { extra: { eas: { projectId: "configured-project" } } };
    notificationsMock.getPermissionsAsync.mockResolvedValueOnce({ status: "granted" });
    notificationsMock.getExpoPushTokenAsync.mockResolvedValueOnce({ data: "ExponentPushToken[native-123]" });

    await expect(requestExpoPushTokenAsync()).resolves.toMatchObject({ status: "registered" });
    expect(notificationsMock.getExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: "configured-project" });
  });

  test("requests a push token without project options when no EAS project id is configured", async () => {
    const { requestExpoPushTokenAsync } = await import("../src/features/notifications/deviceToken");

    notificationsMock.getPermissionsAsync.mockResolvedValueOnce({ status: "granted" });
    notificationsMock.getExpoPushTokenAsync.mockResolvedValueOnce({ data: "ExponentPushToken[local-dev-123]" });

    await expect(requestExpoPushTokenAsync()).resolves.toEqual({
      status: "registered",
      token: "ExponentPushToken[local-dev-123]",
      platform: "android"
    });
    expect(notificationsMock.getExpoPushTokenAsync).toHaveBeenCalledWith(undefined);
  });

  test("refreshes an Expo push token only when permission is already granted", async () => {
    const { refreshExpoPushTokenIfGrantedAsync } = await import("../src/features/notifications/deviceToken");

    notificationsMock.getPermissionsAsync.mockResolvedValueOnce({ status: "undetermined" });

    await expect(refreshExpoPushTokenIfGrantedAsync()).resolves.toEqual({ status: "skipped" });
    expect(notificationsMock.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(notificationsMock.getExpoPushTokenAsync).not.toHaveBeenCalled();

    constantsMock.expoConfig = { extra: { eas: { projectId: "configured-project" } } };
    notificationsMock.getPermissionsAsync.mockResolvedValueOnce({ status: "granted" });
    notificationsMock.getExpoPushTokenAsync.mockResolvedValueOnce({ data: "ExponentPushToken[refreshed-123]" });

    await expect(refreshExpoPushTokenIfGrantedAsync()).resolves.toEqual({
      status: "registered",
      token: "ExponentPushToken[refreshed-123]",
      platform: "android"
    });
    expect(notificationsMock.getExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: "configured-project" });
  });

  test("does not fetch a push token when notification permission is denied", async () => {
    const { requestExpoPushTokenAsync } = await import("../src/features/notifications/deviceToken");

    notificationsMock.getPermissionsAsync.mockResolvedValueOnce({ status: "denied" });
    notificationsMock.requestPermissionsAsync.mockResolvedValueOnce({ status: "denied" });

    await expect(requestExpoPushTokenAsync()).resolves.toEqual({ status: "denied" });
    expect(notificationsMock.getExpoPushTokenAsync).not.toHaveBeenCalled();
  });

  test("treats native notification permission errors as unsupported", async () => {
    const { refreshExpoPushTokenIfGrantedAsync, requestExpoPushTokenAsync } = await import(
      "../src/features/notifications/deviceToken"
    );

    notificationsMock.getPermissionsAsync.mockRejectedValueOnce(new Error("notification module unavailable"));
    await expect(requestExpoPushTokenAsync()).resolves.toEqual({ status: "unsupported" });
    expect(notificationsMock.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(notificationsMock.getExpoPushTokenAsync).not.toHaveBeenCalled();

    notificationsMock.getPermissionsAsync.mockRejectedValueOnce(new Error("notification module unavailable"));
    await expect(refreshExpoPushTokenIfGrantedAsync()).resolves.toEqual({ status: "unsupported" });
    expect(notificationsMock.getExpoPushTokenAsync).not.toHaveBeenCalled();
  });

  test("treats native Expo push token errors as unsupported", async () => {
    const { refreshExpoPushTokenIfGrantedAsync, requestExpoPushTokenAsync } = await import(
      "../src/features/notifications/deviceToken"
    );

    notificationsMock.getPermissionsAsync.mockResolvedValueOnce({ status: "granted" });
    notificationsMock.getExpoPushTokenAsync.mockRejectedValueOnce(new Error("Expo push token unavailable"));
    await expect(requestExpoPushTokenAsync()).resolves.toEqual({ status: "unsupported" });

    notificationsMock.getPermissionsAsync.mockResolvedValueOnce({ status: "granted" });
    notificationsMock.getExpoPushTokenAsync.mockRejectedValueOnce(new Error("Expo push token unavailable"));
    await expect(refreshExpoPushTokenIfGrantedAsync()).resolves.toEqual({ status: "unsupported" });
  });
});
