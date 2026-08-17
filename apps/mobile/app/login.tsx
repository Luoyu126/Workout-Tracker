import { useRouter } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { CompactLanguageToggle } from "@/components/LanguageToggle";
import { Button, Screen, TextField } from "@/components/ui";
import { getMyProfile, signIn, signUp, syncProfile, type SyncProfileInput } from "@/features/auth/api";
import { normalizeAuthCredentials, normalizeProfileInput } from "@/features/auth/validation";
import { ApiError, apiConfig } from "@/lib/api/client";
import { formatApiError } from "@/lib/api/errors";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { supabaseConfig } from "@/lib/supabase/config";
import { colors } from "@/theme/colors";
import { spacing, typography } from "@/theme/tokens";

export default function LoginScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const [mode, setMode] = useState<"signIn" | "signUp">("signIn");
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
        router.replace("/");
      } catch (error) {
        if (error instanceof ApiError && error.code === "USER_NOT_SYNCED") {
          const profileInput = normalizeProfileInput(name, studentId);
          if (profileInput === null) {
            setDidAuthenticate(true);
            setMode("signUp");
            setMessage(t("auth.signInNeedsProfile"));
            return;
          }
          await syncProfile(profileInput);
          setDidAuthenticate(true);
          setMessage(t("auth.signInSyncedProfile"));
          router.replace("/");
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
        router.replace("/");
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
    <Screen scroll contentStyle={styles.content}>
      <View style={styles.brandRow}>
        <Text style={styles.brand}>⚡ SquadHub</Text>
        <CompactLanguageToggle />
      </View>

      <View style={styles.hero}>
        <Text style={styles.title}>{mode === "signIn" ? t("auth.welcomeBack") : t("auth.createAccount")}</Text>
        <Text style={styles.subtitle}>
          {mode === "signIn" ? t("auth.signInHint") : t("auth.signUpHint")}
        </Text>
      </View>

      {!supabaseConfig.isConfigured ? <Text style={styles.message}>{t("auth.supabaseConfigMissing")}</Text> : null}
      {hasApiConfigProblem ? <Text style={styles.message}>{t("auth.apiConfigMissing")}</Text> : null}

      {mode === "signUp" || didAuthenticate ? (
        <>
          <TextField
            autoComplete="name"
            label={t("auth.name")}
            onChangeText={setName}
            textContentType="name"
            value={name}
          />
          <TextField
            autoCorrect={false}
            label={t("auth.studentId")}
            onChangeText={setStudentId}
            value={studentId}
          />
        </>
      ) : null}

      <TextField
        autoCapitalize="none"
        autoComplete="email"
        autoCorrect={false}
        keyboardType="email-address"
        label={t("auth.emailOrStudentId")}
        onChangeText={setEmail}
        placeholder={t("auth.email")}
        textContentType="emailAddress"
        value={email}
      />
      <TextField
        autoCapitalize="none"
        autoComplete="password"
        autoCorrect={false}
        label={t("auth.password")}
        onChangeText={setPassword}
        secureTextEntry
        textContentType="password"
        value={password}
      />

      <Button
        disabled={isSubmitting || !supabaseConfig.isConfigured}
        label={mode === "signIn" ? t("auth.signIn") : t("auth.signUp")}
        onPress={() => void (mode === "signIn" ? handleSignIn() : handleSignUp())}
      />

      <Button
        disabled={isSubmitting || !supabaseConfig.isConfigured}
        label={mode === "signIn" ? t("auth.signUp") : t("auth.signIn")}
        variant="secondary"
        onPress={() => setMode(mode === "signIn" ? "signUp" : "signIn")}
      />

      {didAuthenticate ? (
        <Button label={t("home.openTeams")} variant="ghost" onPress={() => router.replace("/teams")} />
      ) : null}

      <Text style={styles.switchText}>
        {mode === "signIn" ? t("auth.noAccount") : t("auth.hasAccount")}{" "}
        <Text style={styles.switchLink} onPress={() => setMode(mode === "signIn" ? "signUp" : "signIn")}>
          {mode === "signIn" ? t("auth.registerNow") : t("auth.signIn")}
        </Text>
      </Text>

      {message ? <Text style={styles.message}>{message}</Text> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.lg,
    justifyContent: "center",
    paddingTop: spacing.xxxl
  },
  brandRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between"
  },
  brand: {
    color: colors.accentSoft,
    fontSize: 20,
    fontWeight: "800"
  },
  hero: {
    gap: spacing.sm,
    marginBottom: spacing.md
  },
  title: {
    color: colors.text,
    ...typography.title
  },
  subtitle: {
    color: colors.muted,
    ...typography.body
  },
  switchText: {
    color: colors.muted,
    textAlign: "center",
    ...typography.body
  },
  switchLink: {
    color: colors.accentSoft,
    fontWeight: "800"
  },
  message: {
    color: colors.muted,
    ...typography.caption
  }
});
