import { Link } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput } from "react-native";

import { LanguageToggle } from "@/components/LanguageToggle";
import { getMyProfile, signIn, signUp, syncProfile, type SyncProfileInput } from "@/features/auth/api";
import { normalizeAuthCredentials, normalizeProfileInput } from "@/features/auth/validation";
import { ApiError, apiConfig } from "@/lib/api/client";
import { formatApiError } from "@/lib/api/errors";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { supabaseConfig } from "@/lib/supabase/config";
import { colors } from "@/theme/colors";

export default function LoginScreen() {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [studentId, setStudentId] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [didAuthenticate, setDidAuthenticate] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const hasApiConfigProblem = !apiConfig.isConfigured || apiConfig.isMalformed;

  function buildProfileInput(): SyncProfileInput | null {
    const profileInput = normalizeProfileInput(name, studentId);
    if (profileInput === null) {
      setDidAuthenticate(false);
      setMessage(t("auth.nameRequired"));
    }
    return profileInput;
  }

  async function handleSignIn() {
    if (!supabaseConfig.isConfigured) {
      setDidAuthenticate(false);
      setMessage(t("auth.supabaseConfigMissing"));
      return;
    }
    const credentials = normalizeAuthCredentials(email, password);
    if (credentials === null) {
      setDidAuthenticate(false);
      setMessage(t("auth.credentialsRequired"));
      return;
    }
    setIsSubmitting(true);
    setDidAuthenticate(false);
    setMessage(null);
    try {
      await signIn(credentials);
      try {
        await getMyProfile();
        setDidAuthenticate(true);
        setMessage(t("auth.signInSuccess"));
      } catch (error) {
        if (error instanceof ApiError && error.code === "USER_NOT_SYNCED") {
          const profileInput = normalizeProfileInput(name, studentId);
          if (profileInput === null) {
            setDidAuthenticate(true);
            setMessage(t("auth.signInNeedsProfile"));
            return;
          }
          await syncProfile(profileInput);
          setDidAuthenticate(true);
          setMessage(t("auth.signInSyncedProfile"));
          return;
        }
        throw error;
      }
    } catch (error) {
      setMessage(formatApiError(error, t));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSignUp() {
    if (!supabaseConfig.isConfigured) {
      setDidAuthenticate(false);
      setMessage(t("auth.supabaseConfigMissing"));
      return;
    }
    const credentials = normalizeAuthCredentials(email, password);
    if (credentials === null) {
      setDidAuthenticate(false);
      setMessage(t("auth.credentialsRequired"));
      return;
    }
    const profileInput = buildProfileInput();
    if (profileInput === null) {
      return;
    }
    setIsSubmitting(true);
    setDidAuthenticate(false);
    setMessage(null);
    try {
      await signUp(credentials);
      try {
        await syncProfile(profileInput);
        setDidAuthenticate(true);
        setMessage(t("auth.signUpSuccess"));
      } catch {
        setMessage(t("auth.signUpNeedsSignIn"));
      }
    } catch (error) {
      setMessage(formatApiError(error, t));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>{t("auth.signIn")}</Text>
      <LanguageToggle />
      {!supabaseConfig.isConfigured ? (
        <Text style={styles.message}>{t("auth.supabaseConfigMissing")}</Text>
      ) : null}
      {hasApiConfigProblem ? <Text style={styles.message}>{t("auth.apiConfigMissing")}</Text> : null}
      <TextInput
        autoComplete="name"
        textContentType="name"
        onChangeText={setName}
        placeholder={t("auth.name")}
        placeholderTextColor={colors.muted}
        style={styles.input}
        value={name}
      />
      <TextInput
        autoCorrect={false}
        onChangeText={setStudentId}
        placeholder={t("auth.studentId")}
        placeholderTextColor={colors.muted}
        style={styles.input}
        value={studentId}
      />
      <TextInput
        autoCapitalize="none"
        autoComplete="email"
        autoCorrect={false}
        keyboardType="email-address"
        onChangeText={setEmail}
        placeholder={t("auth.email")}
        placeholderTextColor={colors.muted}
        style={styles.input}
        textContentType="emailAddress"
        value={email}
      />
      <TextInput
        autoCapitalize="none"
        autoComplete="password"
        autoCorrect={false}
        onChangeText={setPassword}
        placeholder={t("auth.password")}
        placeholderTextColor={colors.muted}
        secureTextEntry
        style={styles.input}
        textContentType="password"
        value={password}
      />
      <Pressable
        accessibilityRole="button"
        disabled={isSubmitting || !supabaseConfig.isConfigured}
        onPress={handleSignIn}
        style={[styles.button, (isSubmitting || !supabaseConfig.isConfigured) && styles.disabled]}
      >
        <Text style={styles.buttonText}>{t("auth.signIn")}</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        disabled={isSubmitting || !supabaseConfig.isConfigured}
        onPress={handleSignUp}
        style={[styles.secondaryButton, (isSubmitting || !supabaseConfig.isConfigured) && styles.disabled]}
      >
        <Text style={styles.secondaryText}>{t("auth.signUp")}</Text>
      </Pressable>
      {didAuthenticate ? (
        <Link href="/teams" asChild>
          <Pressable accessibilityRole="button" style={styles.secondaryButton}>
            <Text style={styles.secondaryText}>{t("home.openTeams")}</Text>
          </Pressable>
        </Link>
      ) : null}
      {message ? <Text style={styles.message}>{message}</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 14,
    padding: 20,
    paddingTop: 72
  },
  title: {
    color: colors.text,
    fontSize: 30,
    fontWeight: "800",
    marginBottom: 10
  },
  input: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    color: colors.text,
    fontSize: 16,
    minHeight: 52,
    paddingHorizontal: 14
  },
  button: {
    alignItems: "center",
    backgroundColor: colors.accent,
    borderRadius: 8,
    minHeight: 52,
    justifyContent: "center"
  },
  buttonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "800"
  },
  secondaryButton: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: 8,
    minHeight: 52,
    justifyContent: "center"
  },
  secondaryText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "800"
  },
  disabled: {
    opacity: 0.7
  },
  message: {
    color: colors.muted,
    fontSize: 14
  }
});
