import { Link } from "expo-router";
import { useEffect, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput } from "react-native";

import { LanguageToggle } from "@/components/LanguageToggle";
import { ScreenState } from "@/components/ScreenState";
import {
  getMyProfile,
  signOut,
  syncProfile,
  updateProfile,
  type UserProfile
} from "@/features/auth/api";
import { normalizeProfileInput } from "@/features/auth/validation";
import { formatApiError } from "@/lib/api/errors";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { colors } from "@/theme/colors";

export default function ProfileScreen() {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [studentId, setStudentId] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSyncProfile() {
    if (isSubmitting) {
      return;
    }
    const profileInput = normalizeProfileInput(name, studentId, avatarUrl);
    if (profileInput === null) {
      setMessage(t("auth.nameRequired"));
      return;
    }
    setIsSubmitting(true);
    setMessage(null);
    try {
      const syncedProfile = await syncProfile(profileInput);
      setProfile(syncedProfile);
      setName(syncedProfile.name);
      setStudentId(syncedProfile.student_id ?? "");
      setAvatarUrl(syncedProfile.avatar_url ?? "");
      setMessage(t("profile.saved"));
    } catch (error) {
      setMessage(formatApiError(error, t));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleLoadProfile() {
    if (isSubmitting) {
      return;
    }
    setIsSubmitting(true);
    setMessage(null);
    try {
      const currentProfile = await getMyProfile();
      setProfile(currentProfile);
      setName(currentProfile.name);
      setStudentId(currentProfile.student_id ?? "");
      setAvatarUrl(currentProfile.avatar_url ?? "");
    } catch (error) {
      setMessage(formatApiError(error, t));
    } finally {
      setIsSubmitting(false);
    }
  }

  useEffect(() => {
    void handleLoadProfile();
  }, []);

  async function handleUpdateProfile() {
    if (isSubmitting) {
      return;
    }
    const profileInput = normalizeProfileInput(name, studentId, avatarUrl);
    if (profileInput === null) {
      setMessage(t("auth.nameRequired"));
      return;
    }
    setIsSubmitting(true);
    setMessage(null);
    try {
      const updatedProfile = await updateProfile(profileInput);
      setProfile(updatedProfile);
      setName(updatedProfile.name);
      setStudentId(updatedProfile.student_id ?? "");
      setAvatarUrl(updatedProfile.avatar_url ?? "");
      setMessage(t("profile.updated"));
    } catch (error) {
      setMessage(formatApiError(error, t));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSignOut() {
    if (isSubmitting) {
      return;
    }
    setIsSubmitting(true);
    setMessage(null);
    try {
      await signOut();
      setProfile(null);
      setMessage(t("auth.signOutSuccess"));
    } catch (error) {
      setMessage(formatApiError(error, t));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>{t("profile.title")}</Text>
      {avatarUrl.trim().length > 0 ? <Image source={{ uri: avatarUrl.trim() }} style={styles.avatar} /> : null}
      <TextInput
        autoComplete="name"
        textContentType="name"
        onChangeText={setName}
        placeholder={t("profile.name")}
        placeholderTextColor={colors.muted}
        style={styles.input}
        value={name}
      />
      <TextInput
        autoCorrect={false}
        onChangeText={setStudentId}
        placeholder={t("profile.studentId")}
        placeholderTextColor={colors.muted}
        style={styles.input}
        value={studentId}
      />
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        onChangeText={setAvatarUrl}
        placeholder={t("profile.avatarUrl")}
        placeholderTextColor={colors.muted}
        style={styles.input}
        textContentType="URL"
        value={avatarUrl}
      />
      <Link href="/teams" asChild>
        <Pressable accessibilityRole="button" style={styles.secondaryButton}>
          <Text style={styles.secondaryText}>{t("home.openTeams")}</Text>
        </Pressable>
      </Link>
      <Link href="/inbox" asChild>
        <Pressable accessibilityRole="button" style={styles.secondaryButton}>
          <Text style={styles.secondaryText}>{t("profile.notificationSettings")}</Text>
        </Pressable>
      </Link>
      <LanguageToggle />
      <Pressable
        accessibilityRole="button"
        disabled={isSubmitting}
        onPress={handleSyncProfile}
        style={[styles.button, isSubmitting && styles.disabled]}
      >
        <Text style={styles.buttonText}>{t("auth.syncProfile")}</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        disabled={isSubmitting}
        onPress={handleUpdateProfile}
        style={[styles.secondaryButton, isSubmitting && styles.disabled]}
      >
        <Text style={styles.secondaryText}>{t("profile.update")}</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        disabled={isSubmitting}
        onPress={handleLoadProfile}
        style={[styles.secondaryButton, isSubmitting && styles.disabled]}
      >
        <Text style={styles.secondaryText}>{t("profile.load")}</Text>
      </Pressable>
      <ScreenState
        isLoading={isSubmitting}
        authRequiredLabel={t("common.authRequired")}
        loadingLabel={t("common.loading")}
        message={message}
        onRetry={handleLoadProfile}
        retryLabel={t("common.retry")}
        signInLabel={t("home.openLogin")}
      />
      <Pressable
        accessibilityRole="button"
        disabled={isSubmitting}
        onPress={handleSignOut}
        style={[styles.dangerButton, isSubmitting && styles.disabled]}
      >
        <Text style={styles.dangerText}>{t("auth.signOut")}</Text>
      </Pressable>
      {profile ? <Text style={styles.message}>{profile.email}</Text> : null}
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
  avatar: {
    alignSelf: "center",
    backgroundColor: colors.surface,
    borderRadius: 48,
    height: 96,
    width: 96
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
  dangerButton: {
    alignItems: "center",
    backgroundColor: "#fee2e2",
    borderRadius: 8,
    minHeight: 52,
    justifyContent: "center"
  },
  dangerText: {
    color: "#991b1b",
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
