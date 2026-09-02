import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { ScreenState } from "@/components/ScreenState";
import { Badge, Button, Card, EmptyState, Screen, SegmentedControl, TextField } from "@/components/ui";
import {
  createEvent,
  createMatch,
  getTeamEvents,
  type EventStatus,
  type EventType,
  type TeamEvent
} from "@/features/events/api";
import { isValidEventSchedule, parseIsoDateTime, parseOptionalIsoDateTime } from "@/features/events/validation";
import { formatApiError } from "@/lib/api/errors";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { useTeamContext } from "@/providers/TeamProvider";
import { colors } from "@/theme/colors";
import { spacing, typography } from "@/theme/tokens";

function getDefaultStartTime() {
  return new Date(Date.now() + 86_400_000).toISOString();
}

export default function EventsTabScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const { selectedTeamId, role, home } = useTeamContext();
  const canManageEvents = role === "captain" || role === "admin";
  const [events, setEvents] = useState<TeamEvent[]>([]);
  const [filterType, setFilterType] = useState<EventType | null>(null);
  const [filterStatus, setFilterStatus] = useState<EventStatus | null>("published");
  const [showCreate, setShowCreate] = useState(false);
  const [eventType, setEventType] = useState<EventType>("training");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [startTime, setStartTime] = useState(getDefaultStartTime());
  const [endTime, setEndTime] = useState("");
  const [signupDeadline, setSignupDeadline] = useState("");
  const [opponent, setOpponent] = useState("");
  const [matchNotes, setMatchNotes] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const loadEvents = useCallback(async () => {
    if (!selectedTeamId) {
      setEvents([]);
      return;
    }
    setIsLoading(true);
    setMessage(null);
    try {
      const nextEvents = await getTeamEvents(selectedTeamId, {
        type: filterType,
        status: canManageEvents ? filterStatus : filterStatus === "draft" ? "published" : filterStatus
      });
      setEvents(nextEvents);
      if (nextEvents.length === 0) {
        setMessage(t("events.noEvents"));
      }
    } catch (error) {
      setMessage(formatApiError(error, t));
    } finally {
      setIsLoading(false);
    }
  }, [selectedTeamId, filterType, filterStatus, canManageEvents, t]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  async function handleCreateEvent() {
    if (!selectedTeamId || !canManageEvents) {
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
      const created =
        eventType === "match"
          ? await createMatch(selectedTeamId, {
              event: eventInput,
              match_details: {
                opponent: opponent.trim(),
                notes: matchNotes.trim().length > 0 ? matchNotes.trim() : null
              }
            })
          : await createEvent(selectedTeamId, eventInput);
      setTitle("");
      setDescription("");
      setLocation("");
      setStartTime(getDefaultStartTime());
      setEndTime("");
      setSignupDeadline("");
      setOpponent("");
      setMatchNotes("");
      setShowCreate(false);
      setMessage(t("events.created"));
      await loadEvents();
      router.push({ pathname: "/events/[eventId]", params: { eventId: created.id } });
    } catch (error) {
      setMessage(formatApiError(error, t));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Screen
      title={t("events.title")}
      subtitle={home?.team.name}
      refreshing={isLoading}
      onRefresh={() => void loadEvents()}
      headerRight={
        canManageEvents ? (
          <Pressable accessibilityRole="button" onPress={() => setShowCreate((value) => !value)} style={styles.createBtn}>
            <Ionicons color={colors.accentText} name="add" size={20} />
            <Text style={styles.createBtnText}>{t("events.create")}</Text>
          </Pressable>
        ) : null
      }
    >
      {!selectedTeamId ? <EmptyState title={t("teams.noTeams")} actionLabel={t("home.openLogin")} onAction={() => router.push("/login")} /> : null}

      <SegmentedControl
        value={filterType}
        onChange={setFilterType}
        options={[
          { value: null, label: t("events.allTypes") },
          { value: "training", label: t("events.training") },
          { value: "match", label: t("events.match") }
        ]}
      />
      {canManageEvents ? (
        <SegmentedControl
          value={filterStatus}
          onChange={setFilterStatus}
          options={[
            { value: null, label: t("events.allStatuses") },
            { value: "draft", label: t("events.status.draft") },
            { value: "published", label: t("events.status.published") },
            { value: "completed", label: t("events.status.completed") }
          ]}
        />
      ) : null}

      {showCreate && canManageEvents ? (
        <Card>
          <Text style={styles.cardTitle}>{t("events.create")}</Text>
          <SegmentedControl
            value={eventType}
            onChange={setEventType}
            options={[
              { value: "training", label: t("events.training") },
              { value: "match", label: t("events.match") }
            ]}
          />
          <TextField label={t("events.titleField")} onChangeText={setTitle} value={title} />
          <TextField label={t("events.location")} onChangeText={setLocation} value={location} />
          <TextField label={t("events.description")} multiline onChangeText={setDescription} value={description} />
          <TextField
            autoCapitalize="none"
            autoCorrect={false}
            label={t("events.startTime")}
            onChangeText={setStartTime}
            value={startTime}
          />
          <TextField
            autoCapitalize="none"
            autoCorrect={false}
            label={t("events.endTime")}
            onChangeText={setEndTime}
            value={endTime}
          />
          <TextField
            autoCapitalize="none"
            autoCorrect={false}
            label={t("events.signupDeadline")}
            onChangeText={setSignupDeadline}
            value={signupDeadline}
          />
          {eventType === "match" ? (
            <>
              <TextField autoCorrect={false} label={t("events.opponent")} onChangeText={setOpponent} value={opponent} />
              <TextField label={t("events.matchNotes")} multiline onChangeText={setMatchNotes} value={matchNotes} />
            </>
          ) : null}
          <Button disabled={isLoading} label={t("events.createDraft")} onPress={() => void handleCreateEvent()} />
        </Card>
      ) : null}

      <ScreenState
        isLoading={isLoading}
        authRequiredLabel={t("common.authRequired")}
        loadingLabel={t("common.loading")}
        message={message}
        onRetry={() => void loadEvents()}
        retryLabel={t("common.retry")}
        signInLabel={t("home.openLogin")}
      />

      {events.map((event) => (
        <Pressable
          accessibilityRole="button"
          key={event.id}
          onPress={() => router.push({ pathname: "/events/[eventId]", params: { eventId: event.id } })}
        >
          <Card>
            <View style={styles.rowBetween}>
              <Badge
                label={t(`events.${event.type}`)}
                tone={event.type === "match" ? "purple" : "accent"}
              />
              <Badge label={t(`events.status.${event.status}`)} tone={event.status === "draft" ? "warning" : "muted"} />
            </View>
            <Text style={styles.cardTitle}>{event.title}</Text>
            <Text style={styles.muted}>{new Date(event.start_time).toLocaleString()}</Text>
            {event.location ? <Text style={styles.muted}>{event.location}</Text> : null}
          </Card>
        </Pressable>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  createBtn: {
    alignItems: "center",
    backgroundColor: colors.accent,
    borderRadius: 999,
    flexDirection: "row",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  createBtnText: {
    color: colors.accentText,
    fontSize: 13,
    fontWeight: "800"
  },
  cardTitle: {
    color: colors.text,
    ...typography.section
  },
  muted: {
    color: colors.muted,
    ...typography.caption
  },
  rowBetween: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "space-between"
  }
});
