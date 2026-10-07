import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { ScreenState } from "@/components/ScreenState";
import { Card, EmptyState, Screen } from "@/components/ui";
import { getEventSignups, type EventSignup } from "@/features/events/api";
import type { LoadState } from "@/lib/api/loadState";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { colors } from "@/theme/colors";
import { spacing, typography } from "@/theme/tokens";

const CHAIN_STATUSES = ["going", "not_going"] as const;

function compareChainSignup(left: EventSignup, right: EventSignup) {
  const leftTime = left.updated_at ?? "";
  const rightTime = right.updated_at ?? "";
  if (leftTime !== rightTime) {
    return leftTime < rightTime ? -1 : 1;
  }
  const leftName = left.user?.name ?? "";
  const rightName = right.user?.name ?? "";
  if (leftName !== rightName) {
    return leftName.localeCompare(rightName);
  }
  return left.user_id.localeCompare(right.user_id);
}

export default function EventChainScreen() {
  const { eventId } = useLocalSearchParams<{ eventId: string }>();
  return <EventChain key={eventId} eventId={eventId} />;
}

export function EventChain({ eventId }: { eventId: string }) {
  const { t } = useI18n();
  const [loadState, setLoadState] = useState<LoadState>({ status: "idle" });
  const [signups, setSignups] = useState<EventSignup[]>([]);
  const requestVersion = useRef(0);

  const load = useCallback(async () => {
    const version = ++requestVersion.current;
    setLoadState({ status: "loading" });
    try {
      const result = await getEventSignups(eventId);
      if (version === requestVersion.current) {
        setSignups(result);
        setLoadState({ status: "success" });
      }
    } catch (error) {
      if (version === requestVersion.current) setLoadState({ status: "error", error });
    }
  }, [eventId]);

  useFocusEffect(useCallback(() => {
    void load();
    return () => { requestVersion.current += 1; };
  }, [load]));

  return (
    <Screen title={t("events.chainList")} refreshing={loadState.status === "loading"} onRefresh={() => void load()}>
      <ScreenState
        loadState={loadState}
        loadingLabel={t("common.loading")}
        onRetry={() => void load()}
        retryLabel={t("common.retry")}
        authRequiredLabel={t("common.authRequired")}
        signInLabel={t("home.openLogin")}
      />
      {loadState.status === "success" ? (
        signups.length === 0 ? <EmptyState title={t("events.signupList.empty")} /> : (
          CHAIN_STATUSES.map((status) => {
            const members = signups
              .filter((signup) => signup.status === status)
              .slice()
              .sort(compareChainSignup);
            return (
              <Card key={status}>
                <Text style={styles.heading}>{t(`events.chainList.${status}`)} ({members.length})</Text>
                {members.length === 0 ? <Text style={styles.muted}>{t("events.signupList.emptyGroup")}</Text> : (
                  members.map((signup) => (
                    <View key={signup.user_id} style={styles.member}>
                      <Text style={styles.name}>{signup.user?.name ?? signup.user_id}</Text>
                    </View>
                  ))
                )}
              </Card>
            );
          })
        )
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { color: colors.text, ...typography.section },
  member: { gap: spacing.xs, paddingVertical: spacing.xs },
  name: { color: colors.text, ...typography.body },
  muted: { color: colors.muted, ...typography.caption }
});
