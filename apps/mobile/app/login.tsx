import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { CompactLanguageToggle } from "@/components/LanguageToggle";
import { Button, Screen, TextField } from "@/components/ui";
import type { SyncProfileInput } from "@/features/auth/api";
import { normalizeAuthCredentials, normalizeProfileInput } from "@/features/auth/validation";
import { apiConfig } from "@/lib/api/client";
import { formatApiError } from "@/lib/api/errors";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { supabaseConfig } from "@/lib/supabase/config";
import { useAuth } from "@/providers/AuthProvider";
import { colors } from "@/theme/colors";
import { spacing, typography } from "@/theme/tokens";

export default function LoginScreen() {
  const { t } = useI18n();
  const {
    status,
    error: authError,
    signInAndPrepare,
    signUpAndPrepare,
    completeProfile,
    retrySessionCheck,
    signOut
  } = useAuth();
  const [mode, setMode] = useState<"signIn" | "signUp">("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [studentId, setStudentId] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const hasApiConfigProblem = !apiConfig.isConfigured || apiConfig.isMalformed;
  const isCompletingProfile = status === "needsProfile";
  const hasSessionError = status === "error";

  function buildProfileInput(): SyncProfileInput | null {
    const profileInput = normalizeProfileInput(name, studentId);
    if (profileInput === null) {
      setMessage(t("auth.nameRequired"));
    }
    return profileInput;
  }

  async function handleSignIn() {
    if (!supabaseConfig.isConfigured) {
      setMessage(t("auth.supabaseConfigMissing"));
      return;
    }
    const credentials = normalizeAuthCredentials(email, password);
    if (credentials === null) {
      setMessage(t("auth.credentialsRequired"));
      return;
    }
    setIsSubmitting(true);
    setMessage(null);
    try {
      const result = await signInAndPrepare(credentials);
      if (result === "needsProfile") {
        setMessage(t("auth.signInNeedsProfile"));
      }
    } catch (error) {
      setMessage(formatApiError(error, t));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSignUp() {
    if (!supabaseConfig.isConfigured) {
      setMessage(t("auth.supabaseConfigMissing"));
      return;
    }
    const credentials = normalizeAuthCredentials(email, password);
    if (credentials === null) {
      setMessage(t("auth.credentialsRequired"));
      return;
    }
    const profileInput = buildProfileInput();
    if (profileInput === null) {
      return;
    }
    setIsSubmitting(true);
    setMessage(null);
    try {
      const result = await signUpAndPrepare(credentials, profileInput);
      if (result === "verificationRequired") {
        setMessage(t("auth.signUpNeedsSignIn"));
      }
    } catch (error) {
      setMessage(formatApiError(error, t));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCompleteProfile() {
    const profileInput = buildProfileInput();
    if (profileInput === null) {
      return;
    }
    setIsSubmitting(true);
    setMessage(null);
    try {
      await completeProfile(profileInput);
    } catch (error) {
      setMessage(formatApiError(error, t));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRetrySession() {
    setIsSubmitting(true);
    setMessage(null);
    try {
      await retrySessionCheck();
    } catch (error) {
      setMessage(formatApiError(error, t));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSignOut() {
    setIsSubmitting(true);
    setMessage(null);
    try {
      await signOut();
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
        <Text style={styles.title}>
          {isCompletingProfile
            ? t("auth.syncProfile")
            : mode === "signIn"
              ? t("auth.welcomeBack")
              : t("auth.createAccount")}
        </Text>
        <Text style={styles.subtitle}>
          {isCompletingProfile
            ? t("auth.signInNeedsProfile")
            : mode === "signIn"
              ? t("auth.signInHint")
              : t("auth.signUpHint")}
        </Text>
      </View>

      {!supabaseConfig.isConfigured ? <Text style={styles.message}>{t("auth.supabaseConfigMissing")}</Text> : null}
      {hasApiConfigProblem ? <Text style={styles.message}>{t("auth.apiConfigMissing")}</Text> : null}

      {mode === "signUp" || isCompletingProfile ? (
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

      {!isCompletingProfile && !hasSessionError ? (
        <>
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
        </>
      ) : null}

      {hasSessionError ? (
        <>
          <Text style={styles.message}>{formatApiError(authError, t)}</Text>
          <Button disabled={isSubmitting} label={t("common.retry")} onPress={() => void handleRetrySession()} />
          <Button
            disabled={isSubmitting}
            label={t("auth.signOut")}
            variant="secondary"
            onPress={() => void handleSignOut()}
          />
        </>
      ) : isCompletingProfile ? (
        <>
          <Button
            disabled={isSubmitting}
            label={t("auth.syncProfile")}
            onPress={() => void handleCompleteProfile()}
          />
          <Button
            disabled={isSubmitting}
            label={t("auth.signOut")}
            variant="secondary"
            onPress={() => void handleSignOut()}
          />
        </>
      ) : (
        <>
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
        </>
      )}

      {!isCompletingProfile && !hasSessionError ? (
        <Text style={styles.switchText}>
          {mode === "signIn" ? t("auth.noAccount") : t("auth.hasAccount")}{" "}
          <Text style={styles.switchLink} onPress={() => setMode(mode === "signIn" ? "signUp" : "signIn")}>
            {mode === "signIn" ? t("auth.registerNow") : t("auth.signIn")}
          </Text>
        </Text>
      ) : null}

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
