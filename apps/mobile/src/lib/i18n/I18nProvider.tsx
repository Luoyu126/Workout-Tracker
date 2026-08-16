import * as SecureStore from "expo-secure-store";
import { createContext, PropsWithChildren, useContext, useEffect, useMemo, useState } from "react";

import { defaultLocale, Locale, TranslationKey, translations } from "./translations";

type I18nContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => Promise<void>;
  t: (key: TranslationKey) => string;
};

const storageKey = "workout-tracker.locale";
const I18nContext = createContext<I18nContextValue | null>(null);

function isLocale(value: string | null): value is Locale {
  return value === "zh-CN" || value === "en";
}

type LocaleStorage = {
  getItemAsync: (key: string) => Promise<string | null>;
  setItemAsync: (key: string, value: string) => Promise<void>;
};

export async function loadPersistedLocale(storage: LocaleStorage = SecureStore): Promise<Locale | null> {
  try {
    const storedLocale = await storage.getItemAsync(storageKey);
    return isLocale(storedLocale) ? storedLocale : null;
  } catch {
    // Keep the default Chinese locale if secure storage is unavailable.
    return null;
  }
}

export async function persistLocale(nextLocale: Locale, storage: LocaleStorage = SecureStore): Promise<void> {
  try {
    await storage.setItemAsync(storageKey, nextLocale);
  } catch {
    // Language switching should still work in-memory if persistence fails.
  }
}

export function I18nProvider({ children }: PropsWithChildren) {
  const [locale, setLocaleState] = useState<Locale>(defaultLocale);

  useEffect(() => {
    let isMounted = true;
    loadPersistedLocale()
      .then((storedLocale) => {
        if (isMounted && storedLocale !== null) {
          setLocaleState(storedLocale);
        }
      })
      .catch(() => undefined);
    return () => {
      isMounted = false;
    };
  }, []);

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      setLocale: async (nextLocale) => {
        setLocaleState(nextLocale);
        await persistLocale(nextLocale);
      },
      t: (key) => translations[locale][key] ?? translations[defaultLocale][key]
    }),
    [locale]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const value = useContext(I18nContext);

  if (value === null) {
    throw new Error("useI18n must be used inside I18nProvider");
  }

  return value;
}
