import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { ScreenState } from "@/components/ScreenState";
import {
  addTeamMember,
  getMemberCandidates,
  getTeamHome,
  getTeamMembers,
  type MemberCandidate,
  updateTeamMember,
  type Membership,
  type MembershipRole,
  type MembershipStatus
} from "@/features/teams/api";
import { normalizeMemberUserId, normalizeOptionalTeamText } from "@/features/teams/validation";
import { formatApiError } from "@/lib/api/errors";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { colors } from "@/theme/colors";

type MemberDraft = {
  jersey_number: string;
  position: string;
};

export default function TeamMembersScreen() {
  const { teamId } = useLocalSearchParams<{ teamId: string }>();
  const { t } = useI18n();
  const [members, setMembers] = useState<Membership[]>([]);
  const [newUserId, setNewUserId] = useState("");
  const [newJerseyNumber, setNewJerseyNumber] = useState("");
  const [newPosition, setNewPosition] = useState("");
  const [newRole, setNewRole] = useState<MembershipRole>("member");
  const [candidateQuery, setCandidateQuery] = useState("");
  const [candidates, setCandidates] = useState<MemberCandidate[]>([]);
  const [filterRole, setFilterRole] = useState<MembershipRole | null>(null);
  const [filterStatus, setFilterStatus] = useState<MembershipStatus | null>("active");
  const [memberDrafts, setMemberDrafts] = useState<Record<string, MemberDraft>>({});
  const [currentRole, setCurrentRole] = useState<MembershipRole | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const canManageMembers = currentRole === "admin";

  function applyMembers(nextMembers: Membership[]) {
    setMembers(nextMembers);
    setMemberDrafts(
      Object.fromEntries(
        nextMembers.map((membership) => [
          membership.user_id,
          {
            jersey_number: membership.jersey_number ?? "",
            position: membership.position ?? ""
          }
        ])
      )
    );
  }

  async function loadMembers(role: MembershipRole | null, status: MembershipStatus | null) {
    if (!teamId) {
      return;
    }
    const [teamHome, nextMembers] = await Promise.all([
      getTeamHome(teamId),
      getTeamMembers(teamId, { role, status })
    ]);
    setCurrentRole(teamHome.current_membership.role);
    applyMembers(nextMembers);
  }

  async function handleLoadMembers() {
    if (!teamId) {
      return;
    }
    setIsLoading(true);
    setMessage(null);
    try {
      await loadMembers(filterRole, filterStatus);
    } catch (error) {
      setMessage(formatApiError(error, t));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    if (teamId) {
      void handleLoadMembers();
    }
  }, [teamId]);

  async function handleAddMember() {
    if (!teamId) {
      return;
    }
    if (!canManageMembers) {
      setMessage(t("members.adminOnlyHint"));
      return;
    }
    const normalizedUserId = normalizeMemberUserId(newUserId);
    if (normalizedUserId === null) {
      setMessage(t("members.invalidUserId"));
      return;
    }
    setIsLoading(true);
    setMessage(null);
    try {
      await addTeamMember(teamId, {
        user_id: normalizedUserId,
        role: newRole,
        jersey_number: normalizeOptionalTeamText(newJerseyNumber),
        position: normalizeOptionalTeamText(newPosition),
        status: "active"
      });
      await loadMembers(filterRole, filterStatus);
      setMessage(t("members.added"));
    } catch (error) {
      setMessage(formatApiError(error, t));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSearchCandidates() {
    if (!teamId) {
      return;
    }
    if (!canManageMembers) {
      setMessage(t("members.adminOnlyHint"));
      return;
    }
    if (candidateQuery.trim().length < 2) {
      setCandidates([]);
      setMessage(t("members.searchMinLength"));
      return;
    }
    setIsLoading(true);
    setMessage(null);
    try {
      const nextCandidates = await getMemberCandidates(teamId, candidateQuery);
      setCandidates(nextCandidates);
      if (nextCandidates.length === 0) {
        setMessage(t("members.noCandidates"));
      }
    } catch (error) {
      setMessage(formatApiError(error, t));
    } finally {
      setIsLoading(false);
    }
  }

  function handleSelectCandidate(candidate: MemberCandidate) {
    setNewUserId(candidate.id);
    setCandidateQuery(candidate.email);
    setCandidates([]);
    setMessage(t("members.candidateSelected"));
  }

  async function handleUpdateMember(
    membership: Membership,
    patch: Parameters<typeof updateTeamMember>[2]
  ) {
    if (!teamId) {
      return;
    }
    if (!canManageMembers) {
      setMessage(t("members.adminOnlyHint"));
      return;
    }
    setIsLoading(true);
    setMessage(null);
    try {
      await updateTeamMember(teamId, membership.user_id, patch);
      await loadMembers(filterRole, filterStatus);
      setMessage(t("members.updated"));
    } catch (error) {
      setMessage(formatApiError(error, t));
    } finally {
      setIsLoading(false);
    }
  }

  function setMemberDraft(userId: string, patch: Partial<MemberDraft>) {
    setMemberDrafts((currentDrafts) => ({
      ...currentDrafts,
      [userId]: {
        jersey_number: currentDrafts[userId]?.jersey_number ?? "",
        position: currentDrafts[userId]?.position ?? "",
        ...patch
      }
    }));
  }

  function handleSaveMemberProfile(membership: Membership) {
    const draft = memberDrafts[membership.user_id] ?? {
      jersey_number: membership.jersey_number ?? "",
      position: membership.position ?? ""
    };
    void handleUpdateMember(membership, {
      jersey_number: normalizeOptionalTeamText(draft.jersey_number),
      position: normalizeOptionalTeamText(draft.position)
    });
  }

  async function handleSelectFilterRole(role: MembershipRole | null) {
    setFilterRole(role);
    if (!teamId) {
      return;
    }
    setIsLoading(true);
    setMessage(null);
    try {
      await loadMembers(role, filterStatus);
    } catch (error) {
      setMessage(formatApiError(error, t));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSelectFilterStatus(status: MembershipStatus | null) {
    setFilterStatus(status);
    if (!teamId) {
      return;
    }
    setIsLoading(true);
    setMessage(null);
    try {
      await loadMembers(filterRole, status);
    } catch (error) {
      setMessage(formatApiError(error, t));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>{t("members.title")}</Text>
      {!canManageMembers ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t("members.add")}</Text>
          <Text style={styles.muted}>{t("members.adminOnlyHint")}</Text>
        </View>
      ) : null}
      {canManageMembers ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t("members.add")}</Text>
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setCandidateQuery}
          placeholder={t("members.searchPlaceholder")}
          placeholderTextColor={colors.muted}
          style={styles.input}
          value={candidateQuery}
        />
        <Pressable
          accessibilityRole="button"
          disabled={isLoading}
          onPress={handleSearchCandidates}
          style={[styles.secondaryButton, isLoading && styles.disabled]}
        >
          <Text style={styles.secondaryText}>{t("members.search")}</Text>
        </Pressable>
        {candidates.map((candidate) => (
          <Pressable
            accessibilityRole="button"
            disabled={isLoading}
            key={candidate.id}
            onPress={() => handleSelectCandidate(candidate)}
            style={[styles.candidateRow, isLoading && styles.disabled]}
          >
            <Text style={styles.secondaryText}>{candidate.name}</Text>
            <Text style={styles.muted}>
              {candidate.email}
              {candidate.student_id ? ` · ${candidate.student_id}` : ""}
            </Text>
          </Pressable>
        ))}
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setNewUserId}
          placeholder={t("members.userId")}
          placeholderTextColor={colors.muted}
          style={styles.input}
          value={newUserId}
        />
        <View style={styles.row}>
          {(["member", "captain", "admin"] as const).map((role) => (
            <Pressable
              accessibilityRole="button"
              disabled={isLoading}
              key={role}
              onPress={() => setNewRole(role)}
              style={[styles.pillButton, newRole === role && styles.activePill, isLoading && styles.disabled]}
            >
              <Text style={styles.secondaryText}>{role}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.row}>
          <TextInput
            autoCorrect={false}
            onChangeText={setNewJerseyNumber}
            placeholder={t("members.jersey")}
            placeholderTextColor={colors.muted}
            style={[styles.input, styles.rowInput]}
            value={newJerseyNumber}
          />
          <TextInput
            onChangeText={setNewPosition}
            placeholder={t("members.position")}
            placeholderTextColor={colors.muted}
            style={[styles.input, styles.rowInput]}
            value={newPosition}
          />
        </View>
        <Pressable
          accessibilityRole="button"
          disabled={isLoading}
          onPress={handleAddMember}
          style={[styles.button, isLoading && styles.disabled]}
        >
          <Text style={styles.buttonText}>{t("members.add")}</Text>
        </Pressable>
        </View>
      ) : null}
      <Pressable
        accessibilityRole="button"
        disabled={isLoading}
        onPress={handleLoadMembers}
        style={[styles.button, isLoading && styles.disabled]}
      >
        <Text style={styles.buttonText}>{t("members.load")}</Text>
      </Pressable>
      <ScreenState
        isLoading={isLoading}
        authRequiredLabel={t("common.authRequired")}
        loadingLabel={t("common.loading")}
        message={message}
        onRetry={handleLoadMembers}
        retryLabel={t("common.retry")}
        signInLabel={t("home.openLogin")}
      />
      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t("members.filters")}</Text>
        <View style={styles.row}>
          {([null, "member", "captain", "admin"] as const).map((role) => (
            <Pressable
              accessibilityRole="button"
              disabled={isLoading}
              key={role ?? "all"}
              onPress={() => handleSelectFilterRole(role)}
              style={[styles.pillButton, filterRole === role && styles.activePill, isLoading && styles.disabled]}
            >
              <Text style={styles.secondaryText}>
                {role === null ? t("members.allRoles") : t(`members.role.${role}`)}
              </Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.row}>
          {([null, "active", "inactive", "pending"] as const).map((status) => (
            <Pressable
              accessibilityRole="button"
              disabled={isLoading}
              key={status ?? "all"}
              onPress={() => handleSelectFilterStatus(status)}
              style={[styles.pillButton, filterStatus === status && styles.activePill, isLoading && styles.disabled]}
            >
              <Text style={styles.secondaryText}>
                {status === null ? t("members.allStatuses") : t(`members.status.${status}`)}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
      {members.map((membership) => (
        <View key={membership.id} style={styles.card}>
          <Text style={styles.cardTitle}>{membership.user?.name ?? membership.user_id}</Text>
          <Text style={styles.muted}>
            {t(`members.role.${membership.role}`)} · {t(`members.status.${membership.status}`)}
          </Text>
          {membership.user?.email ? <Text style={styles.muted}>{membership.user.email}</Text> : null}
          {membership.jersey_number ? (
            <Text style={styles.muted}>#{membership.jersey_number}</Text>
          ) : null}
          {membership.position ? <Text style={styles.muted}>{membership.position}</Text> : null}
          {canManageMembers ? (
            <>
              <View style={styles.row}>
                <TextInput
                  autoCorrect={false}
                  onChangeText={(value) => setMemberDraft(membership.user_id, { jersey_number: value })}
                  placeholder={t("members.jersey")}
                  placeholderTextColor={colors.muted}
                  style={[styles.input, styles.rowInput]}
                  value={memberDrafts[membership.user_id]?.jersey_number ?? membership.jersey_number ?? ""}
                />
                <TextInput
                  onChangeText={(value) => setMemberDraft(membership.user_id, { position: value })}
                  placeholder={t("members.position")}
                  placeholderTextColor={colors.muted}
                  style={[styles.input, styles.rowInput]}
                  value={memberDrafts[membership.user_id]?.position ?? membership.position ?? ""}
                />
              </View>
              <Pressable
                accessibilityRole="button"
                disabled={isLoading}
                style={[styles.secondaryButton, isLoading && styles.disabled]}
                onPress={() => handleSaveMemberProfile(membership)}
              >
                <Text style={styles.secondaryText}>{t("members.saveProfile")}</Text>
              </Pressable>
              <View style={styles.row}>
                <Pressable
                  accessibilityRole="button"
                  disabled={isLoading}
                  style={[styles.smallButton, isLoading && styles.disabled]}
                  onPress={() => handleUpdateMember(membership, { role: "member" })}
                >
                  <Text style={styles.secondaryText}>{t("members.makeMember")}</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  disabled={isLoading}
                  style={[styles.smallButton, isLoading && styles.disabled]}
                  onPress={() => handleUpdateMember(membership, { role: "captain" })}
                >
                  <Text style={styles.secondaryText}>{t("members.makeCaptain")}</Text>
                </Pressable>
              </View>
              <View style={styles.row}>
                <Pressable
                  accessibilityRole="button"
                  disabled={isLoading}
                  style={[styles.smallButton, isLoading && styles.disabled]}
                  onPress={() => handleUpdateMember(membership, { role: "admin" })}
                >
                  <Text style={styles.secondaryText}>{t("members.makeAdmin")}</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  disabled={isLoading}
                  style={[styles.dangerButton, isLoading && styles.disabled]}
                  onPress={() =>
                    handleUpdateMember(membership, {
                      status: membership.status === "active" ? "inactive" : "active"
                    })
                  }
                >
                  <Text style={styles.secondaryText}>
                    {membership.status === "active" ? t("members.deactivate") : t("members.activate")}
                  </Text>
                </Pressable>
              </View>
            </>
          ) : null}
        </View>
      ))}
      <Text style={styles.message}>{t("members.adminOnlyHint")}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 14,
    padding: 20,
    paddingTop: 16
  },
  title: {
    color: colors.text,
    fontSize: 30,
    fontWeight: "800",
    marginBottom: 10
  },
  button: {
    alignItems: "center",
    backgroundColor: colors.accent,
    borderRadius: 12,
    minHeight: 52,
    justifyContent: "center"
  },
  buttonText: {
    color: colors.accentText,
    fontSize: 16,
    fontWeight: "800"
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    gap: 6,
    padding: 16
  },
  cardTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "800"
  },
  muted: {
    color: colors.muted,
    fontSize: 14
  },
  input: {
    backgroundColor: colors.background,
    borderRadius: 12,
    color: colors.text,
    fontSize: 16,
    minHeight: 48,
    paddingHorizontal: 14
  },
  row: {
    flexDirection: "row",
    gap: 10
  },
  rowInput: {
    flex: 1
  },
  pillButton: {
    alignItems: "center",
    backgroundColor: colors.background,
    borderRadius: 999,
    flex: 1,
    minHeight: 42,
    justifyContent: "center",
    paddingHorizontal: 12
  },
  activePill: {
    backgroundColor: colors.accent
  },
  candidateRow: {
    backgroundColor: colors.background,
    borderRadius: 12,
    gap: 4,
    padding: 12
  },
  smallButton: {
    alignItems: "center",
    backgroundColor: colors.background,
    borderRadius: 12,
    flex: 1,
    minHeight: 42,
    justifyContent: "center",
    marginTop: 4
  },
  secondaryButton: {
    alignItems: "center",
    backgroundColor: colors.background,
    borderRadius: 12,
    minHeight: 42,
    justifyContent: "center",
    marginTop: 4
  },
  dangerButton: {
    alignItems: "center",
    backgroundColor: colors.dangerMuted,
    borderRadius: 12,
    flex: 1,
    minHeight: 42,
    justifyContent: "center",
    marginTop: 4
  },
  secondaryText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "700"
  },
  disabled: {
    opacity: 0.7
  },
  message: {
    color: colors.muted,
    fontSize: 14
  }
});
