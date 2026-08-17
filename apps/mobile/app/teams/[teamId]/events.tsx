import { Link, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { ScreenState } from "@/components/ScreenState";
import {
  createEvent,
  createMatch,
  getTeamEvents,
  type EventStatus,
  type EventType,
  type TeamEvent
} from "@/features/events/api";
import { isValidEventSchedule, parseIsoDateTime, parseOptionalIsoDateTime } from "@/features/events/validation";
import { getTeamHome, type MembershipRole } from "@/features/teams/api";
import { formatApiError } from "@/lib/api/errors";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { colors } from "@/theme/colors";

function getDefaultStartTime() {
  return new Date(Date.now() + 86_400_000).toISOString();
}

export default function TeamEventsScreen() {
  const { teamId } = useLocalSearchParams<{ teamId: string }>();
  const { t } = useI18n();
  const [events, setEvents] = useState<TeamEvent[]>([]);
  const [eventType, setEventType] = useState<EventType>("training");
  const [filterType, setFilterType] = useState<EventType | null>(null);
  const [filterStatus, setFilterStatus] = useState<EventStatus | null>("published");
  const [startsAfter, setStartsAfter] = useState("");
  const [startsBefore, setStartsBefore] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [startTime, setStartTime] = useState(getDefaultStartTime());
  const [endTime, setEndTime] = useState("");
  const [signupDeadline, setSignupDeadline] = useState("");
  const [opponent, setOpponent] = useState("");
  const [matchNotes, setMatchNotes] = useState("");
  const [createdEvent, setCreatedEvent] = useState<TeamEvent | null>(null);
  const [currentRole, setCurrentRole] = useState<MembershipRole | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const canManageEvents = currentRole === "captain" || currentRole === "admin";

  function buildEventsQuery(type: EventType | null, status: EventStatus | null) {
    const parsedStartsAfter = parseOptionalIsoDateTime(startsAfter);
    const parsedStartsBefore = parseOptionalIsoDateTime(startsBefore);
    if ((startsAfter.trim().length > 0 && parsedStartsAfter === null) || (startsBefore.trim().length > 0 && parsedStartsBefore === null)) {
      setMessage(t("events.invalidDateTime"));
      return null;
    }
    return {
      type,
      status,
      startsAfter: parsedStartsAfter,
      startsBefore: parsedStartsBefore
    };
  }

  async function loadEvents(type: EventType | null, status: EventStatus | null, options: { showEmptyMessage: boolean }) {
    if (!teamId) {
      return;
    }
    const query = buildEventsQuery(type, status);
    if (query === null) {
      return;
    }
    const nextEvents = await getTeamEvents(teamId, query);
    setEvents(nextEvents);
    if (options.showEmptyMessage && nextEvents.length === 0) {
      setMessage(t("events.noEvents"));
    }
  }

  async function handleLoadEvents() {
    if (!teamId) {
      return;
    }
    setIsLoading(true);
    setMessage(null);
    try {
      const [teamHome] = await Promise.all([
        getTeamHome(teamId),
        loadEvents(filterType, filterStatus, { showEmptyMessage: true })
      ]);
      setCurrentRole(teamHome.current_membership.role);
    } catch (error) {
      setMessage(formatApiError(error, t));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    if (teamId) {
      void handleLoadEvents();
    }
  }, [teamId]);

  async function handleCreateEvent() {
    if (!teamId) {
      return;
    }
    if (!canManageEvents) {
      setMessage(t("events.captainOnlyHint"));
      return;
    }
    const parsedStartTime = parseIsoDateTime(startTime);
    const parsedEndTime = parseOptionalIsoDateTime(endTime);
    const parsedSignupDeadline = parseOptionalIsoDateTime(signupDeadline);
    if (
      title.trim().length === 0 ||
      parsedStartTime === null ||
      (endTime.trim().length > 0 && parsedEndTime === null) ||
      (signupDeadline.trim().length > 0 && parsedSignupDeadline === null)
    ) {
      setMessage(t("events.invalidEventInput"));
      return;
    }
    if (!isValidEventSchedule(parsedStartTime, parsedEndTime, parsedSignupDeadline)) {
      setMessage(t("events.invalidSchedule"));
      return;
    }
    if (eventType === "match" && opponent.trim().length === 0) {
      setMessage(t("events.invalidMatchInput"));
      return;
    }
    setIsLoading(true);
    setMessage(null);
    try {
      const eventInput = {
        type: eventType,
        title: title.trim(),
        description: description.trim().length > 0 ? description.trim() : null,
        location: location.trim().length > 0 ? location.trim() : null,
        start_time: parsedStartTime,
        end_time: parsedEndTime,
        signup_deadline: parsedSignupDeadline
      };
      const createdEvent =
        eventType === "match"
          ? await createMatch(teamId, {
              event: eventInput,
              match_details: {
                opponent: opponent.trim(),
                notes: matchNotes.trim().length > 0 ? matchNotes.trim() : null
              }
            })
          : await createEvent(teamId, eventInput);
      setCreatedEvent(createdEvent);
      await loadEvents(filterType, filterStatus, { showEmptyMessage: false });
      setTitle("");
      setDescription("");
      setLocation("");
      setStartTime(getDefaultStartTime());
      setEndTime("");
      setSignupDeadline("");
      setOpponent("");
      setMatchNotes("");
      setMessage(t("events.created"));
    } catch (error) {
      setMessage(formatApiError(error, t));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSelectFilterType(type: EventType | null) {
    setFilterType(type);
    if (!teamId) {
      return;
    }
    setIsLoading(true);
    setMessage(null);
    try {
      await loadEvents(type, filterStatus, { showEmptyMessage: true });
    } catch (error) {
      setMessage(formatApiError(error, t));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSelectFilterStatus(status: EventStatus | null) {
    setFilterStatus(status);
    if (!teamId) {
      return;
    }
    setIsLoading(true);
    setMessage(null);
    try {
      await loadEvents(filterType, status, { showEmptyMessage: true });
    } catch (error) {
      setMessage(formatApiError(error, t));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>{t("events.title")}</Text>
      {!canManageEvents ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t("events.create")}</Text>
          <Text style={styles.muted}>{t("events.captainOnlyHint")}</Text>
        </View>
      ) : null}
      {canManageEvents ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t("events.create")}</Text>
          <Text style={styles.muted}>{t("events.captainOnlyHint")}</Text>
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            disabled={isLoading}
            onPress={() => setEventType("training")}
            style={[styles.pillButton, eventType === "training" && styles.activePill, isLoading && styles.disabled]}
          >
            <Text style={styles.secondaryText}>{t("events.training")}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={isLoading}
            onPress={() => setEventType("match")}
            style={[styles.pillButton, eventType === "match" && styles.activePill, isLoading && styles.disabled]}
          >
            <Text style={styles.secondaryText}>{t("events.match")}</Text>
          </Pressable>
        </View>
        <TextInput
          onChangeText={setTitle}
          placeholder={t("events.titleField")}
          placeholderTextColor={colors.muted}
          style={styles.input}
          value={title}
        />
        <TextInput
          multiline
          onChangeText={setDescription}
          placeholder={t("events.description")}
          placeholderTextColor={colors.muted}
          style={[styles.input, styles.multilineInput]}
          value={description}
        />
        <TextInput
          onChangeText={setLocation}
          placeholder={t("events.location")}
          placeholderTextColor={colors.muted}
          style={styles.input}
          value={location}
        />
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setStartTime}
          placeholder={t("events.startTime")}
          placeholderTextColor={colors.muted}
          style={styles.input}
          value={startTime}
        />
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setEndTime}
          placeholder={t("events.endTime")}
          placeholderTextColor={colors.muted}
          style={styles.input}
          value={endTime}
        />
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setSignupDeadline}
          placeholder={t("events.signupDeadline")}
          placeholderTextColor={colors.muted}
          style={styles.input}
          value={signupDeadline}
        />
        {eventType === "match" ? (
          <>
            <TextInput
              autoCorrect={false}
              onChangeText={setOpponent}
              placeholder={t("events.opponent")}
              placeholderTextColor={colors.muted}
              style={styles.input}
              value={opponent}
            />
            <TextInput
              multiline
              onChangeText={setMatchNotes}
              placeholder={t("events.matchNotes")}
              placeholderTextColor={colors.muted}
              style={[styles.input, styles.multilineInput]}
              value={matchNotes}
            />
          </>
        ) : null}
        <Pressable
          accessibilityRole="button"
          disabled={isLoading}
          onPress={handleCreateEvent}
          style={[styles.button, isLoading && styles.disabled]}
        >
          <Text style={styles.buttonText}>{t("events.createDraft")}</Text>
        </Pressable>
        </View>
      ) : null}
      <Pressable
        accessibilityRole="button"
        disabled={isLoading}
        onPress={handleLoadEvents}
        style={[styles.button, isLoading && styles.disabled]}
      >
        <Text style={styles.buttonText}>{t("events.load")}</Text>
      </Pressable>
      <ScreenState
        isLoading={isLoading}
        authRequiredLabel={t("common.authRequired")}
        loadingLabel={t("common.loading")}
        message={message}
        onRetry={handleLoadEvents}
        retryLabel={t("common.retry")}
        signInLabel={t("home.openLogin")}
      />
      {createdEvent ? (
        <Link href={{ pathname: "/events/[eventId]", params: { eventId: createdEvent.id } }} asChild>
          <Pressable accessibilityRole="button" style={styles.secondaryButton}>
            <Text style={styles.secondaryText}>{t("events.detail")}</Text>
          </Pressable>
        </Link>
      ) : null}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t("events.filters")}</Text>
        <View style={styles.actions}>
          {([null, "training", "match"] as const).map((type) => (
            <Pressable
              accessibilityRole="button"
              disabled={isLoading}
              key={type ?? "all"}
              onPress={() => handleSelectFilterType(type)}
              style={[styles.pillButton, filterType === type && styles.activePill, isLoading && styles.disabled]}
            >
              <Text style={styles.secondaryText}>
                {type === null ? t("events.allTypes") : t(`events.${type}`)}
              </Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.actions}>
          {([null, "draft", "published", "completed"] as const).map((status) => (
            <Pressable
              accessibilityRole="button"
              disabled={isLoading}
              key={status ?? "all"}
              onPress={() => handleSelectFilterStatus(status)}
              style={[styles.pillButton, filterStatus === status && styles.activePill, isLoading && styles.disabled]}
            >
              <Text style={styles.secondaryText}>
                {status === null ? t("events.allStatuses") : t(`events.status.${status}`)}
              </Text>
            </Pressable>
          ))}
        </View>
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setStartsAfter}
          placeholder={t("events.startsAfter")}
          placeholderTextColor={colors.muted}
          style={styles.input}
          value={startsAfter}
        />
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setStartsBefore}
          placeholder={t("events.startsBefore")}
          placeholderTextColor={colors.muted}
          style={styles.input}
          value={startsBefore}
        />
      </View>
      {events.map((event) => (
        <View key={event.id} style={styles.card}>
          <Text style={styles.cardTitle}>{event.title}</Text>
          <Text style={styles.muted}>
            {t(`events.${event.type}`)} · {t(`events.status.${event.status}`)}
          </Text>
          <Text style={styles.muted}>{new Date(event.start_time).toLocaleString()}</Text>
          <Link href={{ pathname: "/events/[eventId]", params: { eventId: event.id } }} asChild>
            <Pressable accessibilityRole="button" style={styles.secondaryButton}>
              <Text style={styles.secondaryText}>{t("events.detail")}</Text>
            </Pressable>
          </Link>
        </View>
      ))}
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
    flexDirection: "row",
    gap: 10
  },
  input: {
    backgroundColor: colors.background,
    borderRadius: 12,
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
  secondaryButton: {
    alignItems: "center",
    backgroundColor: colors.background,
    borderRadius: 12,
    minHeight: 44,
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
  }
});
