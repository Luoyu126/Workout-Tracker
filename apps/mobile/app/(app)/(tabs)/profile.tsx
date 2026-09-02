import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { LanguageToggle } from "@/components/LanguageToggle";
import { ScreenState } from "@/components/ScreenState";
import { Avatar, Badge, Button, Card, ListRow, Screen, TextField } from "@/components/ui";
import {
  getMyProfile,
  syncProfile,
  updateProfile,
  type UserProfile
} from "@/features/auth/api";
import { normalizeProfileInput } from "@/features/auth/validation";
import { formatApiError } from "@/lib/api/errors";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { useAuth } from "@/providers/AuthProvider";
import { useTeamContext } from "@/providers/TeamProvider";
import { colors } from "@/theme/colors";
import { spacing, typography } from "@/theme/tokens";

export default function ProfileTabScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const { signOut } = useAuth();
  const { home, role } = useTeamContext();
  const [name, setName] = useState("");
  const [studentId, setStudentId] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editing, setEditing] = useState(false);

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
      setEditing(false);
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
    } catch (error) {
      setMessage(formatApiError(error, t));
    } finally {
      setIsSubmitting(false);
    }
  }

  const roleLabel =
    role === "admin"
      ? t("members.role.admin")
      : role === "captain"
        ? t("members.role.captain")
        : role === "member"
          ? t("members.role.member")
          : null;

  return (
    <Screen title={t("profile.title")} refreshing={isSubmitting} onRefresh={() => void handleLoadProfile()}>
      <Card style={styles.hero}>
        <Avatar uri={avatarUrl} name={name || profile?.name} size={72} />
        <Text style={styles.name}>
          {name || profile?.name || t("profile.title")}
          {roleLabel ? ` (${roleLabel})` : ""}
        </Text>
        {studentId || profile?.student_id ? (
          <Text style={styles.meta}>
            {t("profile.studentId")}: {studentId || profile?.student_id}
          </Text>
        ) : null}
        {profile?.email ? <Text style={styles.meta}>{profile.email}</Text> : null}
        <View style={styles.tags}>
          {home?.current_membership.jersey_number || home?.current_membership.player_name ? (
            <Badge
              tone="gold"
              label={`#${home.current_membership.jersey_number ?? "-"}${
                home.current_membership.player_name ? ` ${home.current_membership.player_name}` : ""
              }`}
            />
          ) : null}
          {home?.team.name ? <Badge label={home.team.name} /> : null}
        </View>
      </Card>

      <ListRow
        title={t("profile.viewMembers")}
        leftIcon="people-outline"
        onPress={() => {
          if (home?.team.id) {
            router.push({ pathname: "/teams/[teamId]/members", params: { teamId: home.team.id } });
          } else {
            router.push("/teams");
          }
        }}
      />
      <ListRow
        title={t("home.openTeams")}
        leftIcon="shirt-outline"
        onPress={() => router.push("/teams")}
      />
      {home?.team.id ? (
        <>
          <ListRow
            title={t("teams.home")}
            leftIcon="home-outline"
            onPress={() => router.push({ pathname: "/teams/[teamId]", params: { teamId: home.team.id } })}
          />
          <ListRow
            title={t("teams.coins")}
            leftIcon="cash-outline"
            onPress={() => router.push({ pathname: "/teams/[teamId]/coins", params: { teamId: home.team.id } })}
          />
          <ListRow
            title={t("signupBoard.title")}
            leftIcon="stats-chart-outline"
            onPress={() =>
              router.push({ pathname: "/teams/[teamId]/signup-board", params: { teamId: home.team.id } })
            }
          />
        </>
      ) : null}
      <ListRow
        title={t("profile.editProfile")}
        leftIcon="create-outline"
        onPress={() => setEditing((value) => !value)}
      />
      <ListRow
        title={t("profile.notificationSettings")}
        leftIcon="notifications-outline"
        onPress={() => router.push("/inbox")}
      />

      {editing ? (
        <Card>
          <TextField label={t("profile.name")} autoComplete="name" textContentType="name" onChangeText={setName} value={name} />
          <TextField
            label={t("profile.studentId")}
            autoCorrect={false}
            onChangeText={setStudentId}
            value={studentId}
          />
          <TextField
            label={t("profile.avatarUrl")}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            textContentType="URL"
            onChangeText={setAvatarUrl}
            value={avatarUrl}
          />
          <Button disabled={isSubmitting} label={t("profile.update")} onPress={() => void handleUpdateProfile()} />
          <Button
            disabled={isSubmitting}
            label={t("auth.syncProfile")}
            variant="secondary"
            onPress={() => void handleSyncProfile()}
          />
        </Card>
      ) : null}

      <LanguageToggle />

      <ScreenState
        isLoading={isSubmitting}
        authRequiredLabel={t("common.authRequired")}
        loadingLabel={t("common.loading")}
        message={message}
        onRetry={handleLoadProfile}
        retryLabel={t("common.retry")}
        signInLabel={t("home.openLogin")}
      />

      <Button
        label={t("auth.signOut")}
        variant="dangerOutline"
        disabled={isSubmitting}
        onPress={() => void handleSignOut()}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    alignItems: "center",
    gap: spacing.sm
  },
  name: {
    color: colors.text,
    textAlign: "center",
    ...typography.titleSm
  },
  meta: {
    color: colors.muted,
    ...typography.caption
  },
  tags: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    justifyContent: "center",
    marginTop: spacing.sm
  }
});
