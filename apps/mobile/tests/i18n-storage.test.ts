import { describe, expect, test, vi } from "vitest";

import { loadPersistedLocale, persistLocale } from "../src/lib/i18n/I18nProvider";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => undefined)
}));

function storageMock(options: { storedLocale?: string | null; rejectReads?: boolean; rejectWrites?: boolean } = {}) {
  return {
    getItemAsync: vi.fn(async () => {
      if (options.rejectReads) {
        throw new Error("secure storage unavailable");
      }
      return options.storedLocale ?? null;
    }),
    setItemAsync: vi.fn(async () => {
      if (options.rejectWrites) {
        throw new Error("secure storage unavailable");
      }
    })
  };
}

describe("i18n locale persistence", () => {
  test("returns null so the provider keeps Simplified Chinese when nothing valid is persisted", async () => {
    const emptyStorage = storageMock();
    const invalidStorage = storageMock({ storedLocale: "fr" });
    const failingStorage = storageMock({ rejectReads: true });

    await expect(loadPersistedLocale(emptyStorage)).resolves.toBeNull();
    await expect(loadPersistedLocale(invalidStorage)).resolves.toBeNull();
    await expect(loadPersistedLocale(failingStorage)).resolves.toBeNull();
    expect(emptyStorage.getItemAsync).toHaveBeenCalledWith("workout-tracker.locale");
  });

  test("restores persisted Chinese and English locales", async () => {
    await expect(loadPersistedLocale(storageMock({ storedLocale: "zh-CN" }))).resolves.toBe("zh-CN");
    await expect(loadPersistedLocale(storageMock({ storedLocale: "en" }))).resolves.toBe("en");
  });

  test("persists locale but treats write failures as non-blocking", async () => {
    const workingStorage = storageMock();
    const failingStorage = storageMock({ rejectWrites: true });

    await expect(persistLocale("en", workingStorage)).resolves.toBeUndefined();
    await expect(persistLocale("zh-CN", failingStorage)).resolves.toBeUndefined();
    expect(workingStorage.setItemAsync).toHaveBeenCalledWith("workout-tracker.locale", "en");
    expect(failingStorage.setItemAsync).toHaveBeenCalledWith("workout-tracker.locale", "zh-CN");
  });
});
