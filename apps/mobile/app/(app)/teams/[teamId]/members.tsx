import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";

import { ScreenState } from "@/components/ScreenState";
import { Button, Screen } from "@/components/ui";
import { getTeamHome, type MembershipRole } from "@/features/teams/api";
import type { LoadState } from "@/lib/api/loadState";
import { useI18n } from "@/lib/i18n/I18nProvider";

export default function TeamMembersScreen() {
  const { teamId } = useLocalSearchParams<{ teamId: string }>();
  return <MemberMenu key={teamId} teamId={teamId} />;
}

export function MemberMenu({ teamId }: { teamId: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [loadState, setLoadState] = useState<LoadState>({ status: "idle" });
  const [role, setRole] = useState<MembershipRole | null>(null);

  async function load() {
    setLoadState({ status: "loading" });
    try {
      const home = await getTeamHome(teamId);
      setRole(home.current_membership.role);
      setLoadState({ status: "success" });
    } catch (error) {
      setLoadState({ status: "error", error });
    }
  }
  useEffect(() => { void load(); }, [teamId]);

  return (
    <Screen title={t("members.title")}>
      <ScreenState loadState={loadState} loadingLabel={t("common.loading")} onRetry={load} retryLabel={t("common.retry")} />
      {loadState.status === "success" ? (
        <>
          <Button label={t("members.view")} onPress={() => router.push({ pathname: "/teams/[teamId]/members/list", params: { teamId } })} />
          {role === "admin" ? <Button label={t("members.addNew")} onPress={() => router.push({ pathname: "/teams/[teamId]/members/requests", params: { teamId } })} /> : null}
        </>
      ) : null}
    </Screen>
  );
}
