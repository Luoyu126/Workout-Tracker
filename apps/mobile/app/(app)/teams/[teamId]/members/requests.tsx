import { useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Text } from "react-native";

import { ScreenState } from "@/components/ScreenState";
import { Button, Card, EmptyState, Screen } from "@/components/ui";
import { getTeamHome, getTeamMembers, updateTeamMember, type Membership } from "@/features/teams/api";
import { formatApiError } from "@/lib/api/errors";
import type { LoadState } from "@/lib/api/loadState";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { colors } from "@/theme/colors";

export default function JoinRequestsScreen() {
  const { teamId } = useLocalSearchParams<{ teamId: string }>();
  return <JoinRequests key={teamId} teamId={teamId} />;
}

export function JoinRequests({ teamId }: { teamId: string }) {
  const { t } = useI18n();
  const [loadState, setLoadState] = useState<LoadState>({ status: "idle" });
  const [requests, setRequests] = useState<Membership[]>([]);
  const [canApprove, setCanApprove] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const submitting = useRef(false);

  async function load() {
    setLoadState({ status: "loading" });
    setMessage(null);
    try {
      const home = await getTeamHome(teamId);
      const isAdmin = home.current_membership.role === "admin";
      setCanApprove(isAdmin);
      setRequests(isAdmin ? await getTeamMembers(teamId, { role: "member", status: "pending" }) : []);
      setLoadState({ status: "success" });
    } catch (error) {
      setLoadState({ status: "error", error });
    }
  }
  useEffect(() => { void load(); }, [teamId]);

  async function review(request: Membership, status: "active" | "inactive") {
    if (!canApprove || submitting.current) return;
    submitting.current = true;
    setIsSubmitting(true);
    setMessage(null);
    try {
      await updateTeamMember(teamId, request.user_id, { status });
      setRequests((current) => current.filter((entry) => entry.id !== request.id));
      setMessage(t(status === "active" ? "members.approved" : "members.rejected"));
    } catch (error) {
      setMessage(formatApiError(error, t));
    } finally {
      submitting.current = false;
      setIsSubmitting(false);
    }
  }

  return (
    <Screen title={t("members.addNew")}>
      <ScreenState loadState={loadState} isLoading={isSubmitting} message={message} loadingLabel={t("common.loading")} onRetry={load} retryLabel={t("common.retry")} />
      {loadState.status === "success" && !canApprove ? <Text style={{ color: colors.muted }}>{t("common.permissionDenied")}</Text> : null}
      {loadState.status === "success" && canApprove ? (
        <>
          {requests.length === 0 ? <EmptyState title={t("members.noRequests")} /> : null}
          {requests.map((request) => (
            <Card key={request.id}>
              <Text style={{ color: colors.text }}>{request.user?.name ?? request.user_id}</Text>
              {request.user?.email ? <Text style={{ color: colors.muted }}>{request.user.email}</Text> : null}
              <Button label={t("members.approve")} disabled={isSubmitting} onPress={() => void review(request, "active")} />
              <Button label={t("members.reject")} variant="dangerOutline" disabled={isSubmitting} onPress={() => void review(request, "inactive")} />
            </Card>
          ))}
        </>
      ) : null}
    </Screen>
  );
}
