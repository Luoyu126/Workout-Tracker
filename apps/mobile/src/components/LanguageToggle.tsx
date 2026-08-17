import { useState } from "react";
import { Pressable, StyleSheet, Text } from "react-native";

import { useI18n } from "@/lib/i18n/I18nProvider";
import { colors } from "@/theme/colors";
import { radius, typography } from "@/theme/tokens";

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

export function CompactLanguageToggle() {
  const { locale, setLocale } = useI18n();
  const [isSaving, setIsSaving] = useState(false);

  return (
    <Pressable
      accessibilityRole="button"
      disabled={isSaving}
      style={[styles.compact, isSaving && styles.disabled]}
      onPress={() => {
        setIsSaving(true);
        void setLocale(locale === "zh-CN" ? "en" : "zh-CN").finally(() => setIsSaving(false));
      }}
    >
      <Text style={styles.compactText}>中 / EN</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  languageButton: {
    alignItems: "center",
    backgroundColor: colors.surfaceElevated,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 16
  },
  languageText: {
    color: colors.text,
    ...typography.bodyStrong
  },
  compact: {
    alignItems: "center",
    borderColor: colors.borderStrong,
    borderRadius: radius.pill,
    borderWidth: 1,
    minHeight: 32,
    justifyContent: "center",
    paddingHorizontal: 12
  },
  compactText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700"
  },
  disabled: {
    opacity: 0.6
  }
});
