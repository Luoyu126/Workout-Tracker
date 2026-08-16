import { useState } from "react";
import { Pressable, StyleSheet, Text } from "react-native";

import { useI18n } from "@/lib/i18n/I18nProvider";
import { colors } from "@/theme/colors";

export function LanguageToggle() {
  const { locale, setLocale, t } = useI18n();
  const [isSaving, setIsSaving] = useState(false);
  const label = `${t("settings.language")}: ${locale}`;

  async function handleToggleLanguage() {
    setIsSaving(true);
    try {
      await setLocale(locale === "zh-CN" ? "en" : "zh-CN");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      disabled={isSaving}
      style={[styles.languageButton, isSaving && styles.disabled]}
      onPress={() => void handleToggleLanguage()}
    >
      <Text style={styles.languageText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  languageButton: {
    alignItems: "center",
    backgroundColor: colors.accent,
    borderRadius: 8,
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: 16
  },
  languageText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "700"
  },
  disabled: {
    opacity: 0.6
  }
});
