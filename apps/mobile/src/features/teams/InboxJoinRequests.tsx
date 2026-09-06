import { useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { ScreenState } from "@/components/ScreenState";
import { Button, Card, EmptyState } from "@/components/ui";
import { getJoinRequests, updateTeamMember, type Membership } from "@/features/teams/api";
import { formatApiError } from "@/lib/api/errors";
import type { LoadState } from "@/lib/api/loadState";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { colors } from "@/theme/colors";
import { spacing, typography } from "@/theme/tokens";

export function InboxJoinRequests({ teamId, refreshVersion }: { teamId: string; refreshVersion: number }) {
  const { t, locale } = useI18n();
  const [requests, setRequests] = useState<Membership[]>([]);
  const [loadState, setLoadState] = useState<LoadState>({ status: "idle" });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ message: string; success: boolean } | null>(null);
  const submitting = useRef(false);
  const active = useRef(false);
  const version = useRef(0);

  const load = useCallback(async () => {
    const currentVersion = ++version.current;
    setLoadState({ status: "loading" });
    try {
      const result = await getJoinRequests(teamId);
      if (active.current && currentVersion === version.current) {
        setRequests(result);
        setLoadState({ status: "success" });
      }
    } catch (error) {
      if (active.current && currentVersion === version.current) setLoadState({ status: "error", error });
    }
  }, [teamId]);

  useFocusEffect(useCallback(() => {
    active.current = true;
    setFeedback(null);
    void load();
    return () => { active.current = false; version.current += 1; };
  }, [load, refreshVersion]));

  async function review(request: Membership, status: "active" | "inactive") {
    if (submitting.current || !active.current) return;
    submitting.current = true;
    setIsSubmitting(true);
    setFeedback(null);
    try {
      await updateTeamMember(teamId, request.user_id, { status });
      if (active.current) {
        setRequests((current) => current.filter((entry) => entry.id !== request.id));
        setFeedback({ message: t(status === "active" ? "members.approved" : "members.rejected"), success: true });
        // Invalidate any read started before the approval completed, then read current pending state.
        void load();
      }
    } catch (error) {
      if (active.current) setFeedback({ message: formatApiError(error, t), success: false });
    } finally {
      submitting.current = false;
      setIsSubmitting(false);
    }
  }

  return (
    <View style={styles.section}>
      <Text style={styles.title}>{t("inbox.joinRequests")}</Text>
      <ScreenState
        loadState={loadState}
        isLoading={isSubmitting}
        message={feedback?.message}
        messageTone={feedback?.success ? "success" : "error"}
        loadingLabel={t("common.loading")}
        onRetry={() => void load()}
        retryLabel={t("common.retry")}
      />
      {loadState.status === "success" ? (
        <>
          {requests.length === 0 ? <EmptyState title={t("members.noRequests")} /> : null}
          {requests.map((request) => (
            <Card key={request.id}>
              <Text style={styles.name}>{request.user?.name ?? request.user_id}</Text>
              {request.user?.email ? <Text style={styles.muted}>{request.user.email}</Text> : null}
              <Text style={styles.muted}>
                {request.request_submitted_at
                  ? `${t("inbox.requestSubmittedAt")}: ${new Date(request.request_submitted_at).toLocaleString(locale === "zh-CN" ? "zh-CN" : "en")}`
                  : t("inbox.requestTimeUnknown")}
              </Text>
              <View style={styles.actions}>
                <Button style={styles.action} label={t("members.approve")} disabled={isSubmitting} onPress={() => void review(request, "active")} />
                <Button style={styles.action} label={t("members.reject")} variant="dangerOutline" disabled={isSubmitting} onPress={() => void review(request, "inactive")} />
              </View>
            </Card>
          ))}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.md },
  title: { color: colors.text, ...typography.section },
  name: { color: colors.text, ...typography.bodyStrong },
  muted: { color: colors.muted, ...typography.caption },
  actions: { flexDirection: "row", gap: spacing.sm },
  action: { flex: 1 }
});
