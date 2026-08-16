import { Link, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { ScreenState } from "@/components/ScreenState";
import {
  deleteEvent,
  getEvent,
  getMySignup,
  publishEvent,
  updateEvent,
  updateMySignup,
  type EventSignup,
  type MatchDetails,
  type TeamEvent
} from "@/features/events/api";
import {
  isSignupOpen,
  isValidMatchScoreResult,
  isValidEventSchedule,
  parseIsoDateTime,
  parseOptionalIsoDateTime,
  parseOptionalNonNegativeInteger
} from "@/features/events/validation";
import { getTeamHome, type MembershipRole } from "@/features/teams/api";
import { formatApiError } from "@/lib/api/errors";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { colors } from "@/theme/colors";

export default function EventDetailScreen() {
  const { eventId } = useLocalSearchParams<{ eventId: string }>();
  const router = useRouter();
  const { t } = useI18n();
  const [event, setEvent] = useState<TeamEvent | null>(null);
  const [signup, setSignup] = useState<EventSignup | null>(null);
  const [signupNote, setSignupNote] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editLocation, setEditLocation] = useState("");
  const [editStartTime, setEditStartTime] = useState("");
  const [editEndTime, setEditEndTime] = useState("");
  const [editSignupDeadline, setEditSignupDeadline] = useState("");
  const [editOpponent, setEditOpponent] = useState("");
  const [editTeamScore, setEditTeamScore] = useState("");
  const [editOpponentScore, setEditOpponentScore] = useState("");
  const [editMatchResult, setEditMatchResult] = useState<MatchDetails["result"]>(null);
  const [editMatchNotes, setEditMatchNotes] = useState("");
  const [currentRole, setCurrentRole] = useState<MembershipRole | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  function applyLoadedEvent(loadedEvent: TeamEvent, loadedSignup: EventSignup) {
    setEvent(loadedEvent);
    setSignup(loadedSignup);
    setSignupNote(loadedSignup.note ?? "");
    setEditTitle(loadedEvent.title);
    setEditDescription(loadedEvent.description ?? "");
    setEditLocation(loadedEvent.location ?? "");
    setEditStartTime(loadedEvent.start_time);
    setEditEndTime(loadedEvent.end_time ?? "");
    setEditSignupDeadline(loadedEvent.signup_deadline ?? "");
    setEditOpponent(loadedEvent.match_details?.opponent ?? "");
    setEditTeamScore(loadedEvent.match_details?.team_score?.toString() ?? "");
    setEditOpponentScore(loadedEvent.match_details?.opponent_score?.toString() ?? "");
    setEditMatchResult(loadedEvent.match_details?.result ?? null);
    setEditMatchNotes(loadedEvent.match_details?.notes ?? "");
  }

  async function loadEventBundle() {
    if (!eventId) {
      return null;
    }
    const [loadedEvent, loadedSignup] = await Promise.all([getEvent(eventId), getMySignup(eventId)]);
    const teamHome = await getTeamHome(loadedEvent.team_id);
    return { loadedEvent, loadedSignup, currentRole: teamHome.current_membership.role };
  }

  async function handleLoadEvent() {
    if (!eventId) {
      return;
    }
    setIsLoading(true);
    setMessage(null);
    try {
      const bundle = await loadEventBundle();
      if (bundle) {
        applyLoadedEvent(bundle.loadedEvent, bundle.loadedSignup);
        setCurrentRole(bundle.currentRole);
      }
    } catch (error) {
      setMessage(formatApiError(error, t));
    } finally {
      setIsLoading(false);
    }
  }

  async function refreshEventSilently() {
    if (!eventId) {
      return;
    }
    const bundle = await loadEventBundle();
    if (bundle) {
      applyLoadedEvent(bundle.loadedEvent, bundle.loadedSignup);
      setCurrentRole(bundle.currentRole);
    }
  }

  useEffect(() => {
    if (eventId) {
      void handleLoadEvent();
    }
  }, [eventId]);

  const canUpdateSignup = event?.status === "published" && isSignupOpen(event.signup_deadline, event.start_time);
  const canManageEventStatus = event?.status === "draft" || event?.status === "published";
  const canManageEventRole = currentRole === "captain" || currentRole === "admin";
  const canManageEvent = canManageEventStatus && canManageEventRole;

  async function handleSignup(status: "going" | "maybe" | "not_going") {
    if (!eventId) {
      return;
    }
    if (!canUpdateSignup) {
      setMessage(t("events.signupReadonly"));
      return;
    }
    const normalizedNote = signupNote.trim();
    if (status === "not_going" && normalizedNote.length === 0) {
      setMessage(t("events.signupNoteRequired"));
      return;
    }
    setIsLoading(true);
    setMessage(null);
    try {
      const savedSignup = await updateMySignup(
        eventId,
        status,
        status === "not_going" ? normalizedNote : null
      );
      setSignup(savedSignup);
      setSignupNote(savedSignup.note ?? "");
      await refreshEventSilently();
      setMessage(t("events.signupSaved"));
    } catch (error) {
      setMessage(formatApiError(error, t));
    } finally {
      setIsLoading(false);
    }
  }

  async function handlePublishEvent() {
    if (!eventId) {
      return;
    }
    if (!canManageEventRole) {
      setMessage(t("events.captainOnlyHint"));
      return;
    }
    if (event?.status !== "draft") {
      setMessage(t("events.manageReadonly"));
      return;
    }
    setIsLoading(true);
    setMessage(null);
    try {
      await publishEvent(eventId);
      await refreshEventSilently();
      setMessage(t("events.published"));
    } catch (error) {
      setMessage(formatApiError(error, t));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleUpdateEvent() {
    if (!eventId) {
      return;
    }
    if (!canManageEventRole) {
      setMessage(t("events.captainOnlyHint"));
      return;
    }
    if (!canManageEventStatus) {
      setMessage(t("events.manageReadonly"));
      return;
    }
    const parsedStartTime = parseIsoDateTime(editStartTime);
    const parsedEndTime = parseOptionalIsoDateTime(editEndTime);
    const parsedSignupDeadline = parseOptionalIsoDateTime(editSignupDeadline);
    const teamScore = parseOptionalNonNegativeInteger(editTeamScore);
    const opponentScore = parseOptionalNonNegativeInteger(editOpponentScore);
    if (
      editTitle.trim().length === 0 ||
      parsedStartTime === null ||
      (editEndTime.trim().length > 0 && parsedEndTime === null) ||
      (editSignupDeadline.trim().length > 0 && parsedSignupDeadline === null)
    ) {
      setMessage(t("events.invalidEventInput"));
      return;
    }
    if (!isValidEventSchedule(parsedStartTime, parsedEndTime, parsedSignupDeadline)) {
      setMessage(t("events.invalidSchedule"));
      return;
    }
    if (
      event?.type === "match" &&
      (editOpponent.trim().length === 0 ||
        (editTeamScore.trim().length > 0 && teamScore === null) ||
        (editOpponentScore.trim().length > 0 && opponentScore === null))
    ) {
      setMessage(t("events.invalidMatchInput"));
      return;
    }
    if (event?.type === "match" && !isValidMatchScoreResult(teamScore, opponentScore, editMatchResult)) {
      setMessage(t("events.invalidMatchScoreResult"));
      return;
    }
    setIsLoading(true);
    setMessage(null);
    try {
      await updateEvent(eventId, {
        title: editTitle.trim(),
        description: editDescription.trim().length > 0 ? editDescription.trim() : null,
        location: editLocation.trim().length > 0 ? editLocation.trim() : null,
        start_time: parsedStartTime,
        end_time: parsedEndTime,
        signup_deadline: parsedSignupDeadline,
        ...(event?.type === "match"
          ? {
              match_details: {
                opponent: editOpponent.trim(),
                team_score: teamScore,
                opponent_score: opponentScore,
                result: editMatchResult,
                notes: editMatchNotes.trim().length > 0 ? editMatchNotes.trim() : null
              }
            }
          : {})
      });
      await refreshEventSilently();
      setMessage(t("events.updated"));
    } catch (error) {
      setMessage(formatApiError(error, t));
    } finally {
      setIsLoading(false);
    }
  }

  async function performDeleteEvent() {
    if (!eventId) {
      return;
    }
    if (!canManageEventRole) {
      setMessage(t("events.captainOnlyHint"));
      return;
    }
    if (!canManageEventStatus) {
      setMessage(t("events.manageReadonly"));
      return;
    }
    setIsLoading(true);
    setMessage(null);
    try {
      const deletedTeamId = event?.team_id ?? null;
      await deleteEvent(eventId);
      setEvent(null);
      setSignup(null);
      setMessage(t("events.deleted"));
      if (deletedTeamId) {
        router.replace({ pathname: "/teams/[teamId]/events", params: { teamId: deletedTeamId } });
      }
    } catch (error) {
      setMessage(formatApiError(error, t));
    } finally {
      setIsLoading(false);
    }
  }

  function handleDeleteEvent() {
    if (!canManageEventRole) {
      setMessage(t("events.captainOnlyHint"));
      return;
    }
    if (!canManageEventStatus) {
      setMessage(t("events.manageReadonly"));
      return;
    }
    Alert.alert(t("events.deleteConfirmTitle"), t("events.deleteConfirmBody"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("events.deleteConfirmAction"), style: "destructive", onPress: () => void performDeleteEvent() }
    ]);
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>{t("events.detail")}</Text>
      <Pressable
        accessibilityRole="button"
        disabled={isLoading}
        onPress={handleLoadEvent}
        style={[styles.button, isLoading && styles.disabled]}
      >
        <Text style={styles.buttonText}>{t("events.load")}</Text>
      </Pressable>
      <ScreenState
        isLoading={isLoading}
        authRequiredLabel={t("common.authRequired")}
        loadingLabel={t("common.loading")}
        message={message}
        onRetry={handleLoadEvent}
        retryLabel={t("common.retry")}
        signInLabel={t("home.openLogin")}
      />
      {event ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{event.title}</Text>
          <Text style={styles.muted}>
            {t(`events.${event.type}`)} · {t(`events.status.${event.status}`)}
          </Text>
          <Text style={styles.muted}>{event.location ?? ""}</Text>
          <Text style={styles.muted}>{new Date(event.start_time).toLocaleString()}</Text>
          {event.match_details ? (
            <Text style={styles.muted}>{event.match_details.opponent}</Text>
          ) : null}
        </View>
      ) : null}
      {event && !canManageEvent ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t("events.manage")}</Text>
          <Text style={styles.muted}>
            {canManageEventStatus ? t("events.captainOnlyHint") : t("events.manageReadonly")}
          </Text>
        </View>
      ) : null}
      {event && canManageEvent ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t("events.manage")}</Text>
          <Text style={styles.muted}>{t("events.captainOnlyHint")}</Text>
          <TextInput
            onChangeText={setEditTitle}
            placeholder={t("events.titleField")}
            placeholderTextColor={colors.muted}
            style={styles.input}
            value={editTitle}
          />
          <TextInput
            onChangeText={setEditLocation}
            placeholder={t("events.location")}
            placeholderTextColor={colors.muted}
            style={styles.input}
            value={editLocation}
          />
          <TextInput
            multiline
            onChangeText={setEditDescription}
            placeholder={t("events.description")}
            placeholderTextColor={colors.muted}
            style={[styles.input, styles.multilineInput]}
            value={editDescription}
          />
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setEditStartTime}
            placeholder={t("events.startTime")}
            placeholderTextColor={colors.muted}
            style={styles.input}
            value={editStartTime}
          />
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setEditEndTime}
            placeholder={t("events.endTime")}
            placeholderTextColor={colors.muted}
            style={styles.input}
            value={editEndTime}
          />
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setEditSignupDeadline}
            placeholder={t("events.signupDeadline")}
            placeholderTextColor={colors.muted}
            style={styles.input}
            value={editSignupDeadline}
          />
          {event.type === "match" ? (
            <View style={styles.matchDetailsForm}>
              <Text style={styles.cardTitle}>{t("events.matchDetails")}</Text>
              <TextInput
                onChangeText={setEditOpponent}
                placeholder={t("events.opponent")}
                placeholderTextColor={colors.muted}
                style={styles.input}
                value={editOpponent}
              />
              <View style={styles.row}>
                <TextInput
                  keyboardType="number-pad"
                  onChangeText={setEditTeamScore}
                  placeholder={t("events.teamScore")}
                  placeholderTextColor={colors.muted}
                  style={[styles.input, styles.rowInput]}
                  value={editTeamScore}
                />
                <TextInput
                  keyboardType="number-pad"
                  onChangeText={setEditOpponentScore}
                  placeholder={t("events.opponentScore")}
                  placeholderTextColor={colors.muted}
                  style={[styles.input, styles.rowInput]}
                  value={editOpponentScore}
                />
              </View>
              <View style={styles.row}>
                {(["win", "draw", "loss"] as const).map((result) => (
                  <Pressable
                    accessibilityRole="button"
                    disabled={isLoading}
                    key={result}
                    onPress={() => setEditMatchResult(editMatchResult === result ? null : result)}
                    style={[
                      styles.secondaryButton,
                      styles.rowInput,
                      editMatchResult === result && styles.activeButton,
                      isLoading && styles.disabled
                    ]}
                  >
                    <Text style={styles.secondaryText}>{t(`events.result.${result}`)}</Text>
                  </Pressable>
                ))}
              </View>
              <TextInput
                multiline
                onChangeText={setEditMatchNotes}
                placeholder={t("events.matchNotes")}
                placeholderTextColor={colors.muted}
                style={[styles.input, styles.multilineInput]}
                value={editMatchNotes}
              />
            </View>
          ) : null}
          {event.status === "draft" ? (
            <Pressable
              accessibilityRole="button"
              disabled={isLoading}
              onPress={handlePublishEvent}
              style={[styles.secondaryButton, isLoading && styles.disabled]}
            >
              <Text style={styles.secondaryText}>{t("events.publish")}</Text>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            disabled={isLoading}
            onPress={handleUpdateEvent}
            style={[styles.secondaryButton, isLoading && styles.disabled]}
          >
            <Text style={styles.secondaryText}>{t("events.update")}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={isLoading}
            onPress={handleDeleteEvent}
            style={[styles.dangerButton, isLoading && styles.disabled]}
          >
            <Text style={styles.secondaryText}>{t("events.delete")}</Text>
          </Pressable>
        </View>
      ) : null}
      {event ? (
        <View style={styles.actions}>
          {signup ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{t("events.mySignup")}</Text>
              <Text style={styles.muted}>{t(`events.signup.${signup.status}`)}</Text>
              {signup.note ? <Text style={styles.muted}>{signup.note}</Text> : null}
              {!canUpdateSignup ? <Text style={styles.muted}>{t("events.signupReadonly")}</Text> : null}
            </View>
          ) : null}
          {canUpdateSignup ? (
            <>
              <TextInput
                onChangeText={setSignupNote}
                placeholder={t("events.signupNote")}
                placeholderTextColor={colors.muted}
                style={styles.input}
                value={signupNote}
              />
              <Pressable
                accessibilityRole="button"
                disabled={isLoading}
                style={[styles.secondaryButton, isLoading && styles.disabled]}
                onPress={() => handleSignup("going")}
              >
                <Text style={styles.secondaryText}>{t("events.signupGoing")}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={isLoading}
                style={[styles.secondaryButton, isLoading && styles.disabled]}
                onPress={() => handleSignup("maybe")}
              >
                <Text style={styles.secondaryText}>{t("events.signupMaybe")}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={isLoading}
                style={[styles.secondaryButton, isLoading && styles.disabled]}
                onPress={() => handleSignup("not_going")}
              >
                <Text style={styles.secondaryText}>{t("events.signupNotGoing")}</Text>
              </Pressable>
            </>
          ) : null}
        </View>
      ) : null}
      {event && eventId ? (
        <Link href={{ pathname: "/events/[eventId]/attendance", params: { eventId } }} asChild>
          <Pressable accessibilityRole="button" style={styles.secondaryButton}>
            <Text style={styles.secondaryText}>{t("attendance.title")}</Text>
          </Pressable>
        </Link>
      ) : null}
      {event?.type === "match" && eventId ? (
        <Link href={{ pathname: "/events/[eventId]/live", params: { eventId } }} asChild>
          <Pressable accessibilityRole="button" style={styles.secondaryButton}>
            <Text style={styles.secondaryText}>{t("match.liveBoard")}</Text>
          </Pressable>
        </Link>
      ) : null}
      {event?.type === "match" && eventId ? (
        <Link href={{ pathname: "/events/[eventId]/summary", params: { eventId } }} asChild>
          <Pressable accessibilityRole="button" style={styles.secondaryButton}>
            <Text style={styles.secondaryText}>{t("match.summary")}</Text>
          </Pressable>
        </Link>
      ) : null}
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
  card: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    gap: 8,
    padding: 16
  },
  cardTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "800"
  },
  muted: {
    color: colors.muted,
    fontSize: 14
  },
  actions: {
    gap: 10
  },
  input: {
    backgroundColor: colors.background,
    borderRadius: 8,
    color: colors.text,
    fontSize: 16,
    minHeight: 48,
    paddingHorizontal: 14
  },
  multilineInput: {
    minHeight: 84,
    paddingTop: 12,
    textAlignVertical: "top"
  },
  matchDetailsForm: {
    gap: 10
  },
  row: {
    flexDirection: "row",
    gap: 10
  },
  rowInput: {
    flex: 1
  },
  activeButton: {
    backgroundColor: colors.accent
  },
  secondaryButton: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: 8,
    minHeight: 48,
    justifyContent: "center"
  },
  dangerButton: {
    alignItems: "center",
    backgroundColor: "#7f1d1d",
    borderRadius: 8,
    minHeight: 48,
    justifyContent: "center"
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
