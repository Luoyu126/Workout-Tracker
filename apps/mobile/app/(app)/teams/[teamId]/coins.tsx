import { DateTimeField } from "@/components/ui/DateTimeField";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { ScreenState } from "@/components/ScreenState";
import {
  createManualCoinTransaction,
  createCoinRule,
  getCoinBalance,
  getMyCoinTransactions,
  getCoinRules,
  updateCoinRule,
  type CoinTransaction,
  type CoinTransactionType,
  type CoinRule,
  type CoinRuleTrigger
} from "@/features/coins/api";
import {
  normalizeCoinReason,
  normalizeCoinTargetUserId,
  parseCoinRuleAmount,
  parseManualCoinAmount,
  selectEffectiveCoinRule
} from "@/features/coins/validation";
import { parseOptionalIsoDateTime } from "@/features/events/validation";
import { getTeamHome, getTeamMembers, type Membership, type MembershipRole } from "@/features/teams/api";
import { formatApiError } from "@/lib/api/errors";
import { isEmptyLoad, type LoadState } from "@/lib/api/loadState";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { useTransientFeedback } from "@/lib/ui/useTransientFeedback";
import type { TranslationKey } from "@/lib/i18n/translations";
import { generateClientUuid } from "@/lib/uuid";
import { colors } from "@/theme/colors";

type SignupCoinRuleTrigger = Exclude<CoinRuleTrigger, "manual">;

const defaultRuleInputs: Array<{
  trigger: SignupCoinRuleTrigger;
  labelKey: TranslationKey;
  defaultAmount: string;
}> = [
  { trigger: "training_signup", labelKey: "coins.training", defaultAmount: "10" },
  { trigger: "match_signup", labelKey: "coins.match", defaultAmount: "20" }
];

const coinTransactionTypes: Array<CoinTransactionType | null> = [
  null,
  "signup_reward",
  "redemption",
  "admin_adjustment",
  "other_reward",
  "refund"
];

type PendingManualAdjustmentRequest = {
  id: string;
  userId: string;
  amount: number;
  reason: string | null;
};

export default function TeamCoinsScreen() {
  const [loadState, setLoadState] = useState<LoadState>({ status: "idle" });
  const { teamId } = useLocalSearchParams<{ teamId: string }>();
  const { t } = useI18n();
  const [rules, setRules] = useState<CoinRule[]>([]);
  const [transactions, setTransactions] = useState<CoinTransaction[]>([]);
  const [members, setMembers] = useState<Membership[]>([]);
  const [balance, setBalance] = useState<number | null>(null);
  const [amounts, setAmounts] = useState<Record<SignupCoinRuleTrigger, string>>({
    training_signup: "10",
    match_signup: "20"
  });
  const [targetUserId, setTargetUserId] = useState("");
  const [adjustAmount, setAdjustAmount] = useState("10");
  const [adjustReason, setAdjustReason] = useState("");
  const [pendingManualAdjustment, setPendingManualAdjustment] = useState<PendingManualAdjustmentRequest | null>(null);
  const [transactionType, setTransactionType] = useState<CoinTransactionType | null>(null);
  const [createdAfter, setCreatedAfter] = useState("");
  const [createdBefore, setCreatedBefore] = useState("");
  const [currentRole, setCurrentRole] = useState<MembershipRole | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useTransientFeedback(isLoading || loadState.status === "loading");
  const canManageCoins = currentRole === "admin";
  const canAdjustCoins = currentRole === "admin";

  function buildTransactionQuery(type: CoinTransactionType | null) {
    const parsedCreatedAfter = parseOptionalIsoDateTime(createdAfter);
    const parsedCreatedBefore = parseOptionalIsoDateTime(createdBefore);
    if (
      (createdAfter.trim().length > 0 && parsedCreatedAfter === null) ||
      (createdBefore.trim().length > 0 && parsedCreatedBefore === null)
    ) {
      setMessage(t("coins.invalidDateTime"));
      return null;
    }
    return {
      type,
      createdAfter: parsedCreatedAfter,
      createdBefore: parsedCreatedBefore
    };
  }

  async function refreshCoinData() {
    if (!teamId) {
      return false;
    }
    const transactionQuery = buildTransactionQuery(transactionType);
    if (transactionQuery === null) {
      return false;
    }
    const teamHome = await getTeamHome(teamId);
    const nextRole = teamHome.current_membership.role;
    const canManageWithNextRole = nextRole === "admin";
    const [nextBalance, nextTransactions] = nextRole === "member"
      ? await Promise.all([getCoinBalance(teamId), getMyCoinTransactions(teamId, transactionQuery)])
      : [null, []];
    const [nextRules, nextMembers] = await Promise.all([
      getCoinRules(teamId),
      canManageWithNextRole ? getTeamMembers(teamId) : Promise.resolve([])
    ]);
    setCurrentRole(nextRole);
    setBalance(nextBalance?.balance ?? null);
    setRules(nextRules);
    setTransactions(nextTransactions);
    setMembers(nextMembers.filter((membership) => membership.status === "active"));
    setAmounts((currentAmounts) => {
      const nextAmounts = { ...currentAmounts };
      for (const ruleInput of defaultRuleInputs) {
        const effectiveRule = selectEffectiveCoinRule(nextRules, ruleInput.trigger);
        if (effectiveRule !== null) {
          nextAmounts[ruleInput.trigger] = String(effectiveRule.amount);
        }
      }
      return nextAmounts;
    });
    return true;
  }

  async function handleLoadCoins() {
    if (!teamId) {
      return;
    }
    setIsLoading(true);
    setMessage(null);
    setLoadState({ status: "loading" });
    try {
      const loaded = await refreshCoinData();
      setLoadState({ status: loaded ? "success" : "idle" });
    } catch (error) {
      setLoadState({ status: "error", error });
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    if (teamId) {
      void handleLoadCoins();
    }
  }, [teamId]);

  async function handleSaveRule(trigger: SignupCoinRuleTrigger, label: string) {
    if (!teamId) {
      return;
    }
    if (!canManageCoins) {
      setMessage(t("coins.captainOnlyHint"));
      return;
    }
    const amount = parseCoinRuleAmount(amounts[trigger]);
    if (amount === null) {
      setMessage(t("coins.invalidAmount"));
      return;
    }
    setIsLoading(true);
    setMessage(null);
    try {
      const existingRule = selectEffectiveCoinRule(rules, trigger);
      if (existingRule == null) {
        await createCoinRule(teamId, {
          name: label,
          trigger_type: trigger,
          amount,
          config: null,
          is_active: true
        });
      } else {
        await updateCoinRule(existingRule.id, {
          name: label,
          amount,
          config: null,
          is_active: true
        });
      }
      await refreshCoinData();
      setMessage(t("coins.saved"));
    } catch (error) {
      setMessage(formatApiError(error, t));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleManualAdjustment() {
    if (!teamId) {
      return;
    }
    if (!canAdjustCoins) {
      setMessage(t("coins.adminOnlyHint"));
      return;
    }
    const normalizedTargetUserId = normalizeCoinTargetUserId(targetUserId);
    if (normalizedTargetUserId === null) {
      setMessage(t("coins.invalidUserId"));
      return;
    }
    const amount = parseManualCoinAmount(adjustAmount);
    if (amount === null) {
      setMessage(t("coins.invalidManualAmount"));
      return;
    }
    const reason = normalizeCoinReason(adjustReason);
    const nextManualAdjustment =
      pendingManualAdjustment?.userId === normalizedTargetUserId &&
      pendingManualAdjustment.amount === amount &&
      pendingManualAdjustment.reason === reason
        ? pendingManualAdjustment
        : {
            id: generateClientUuid(),
            userId: normalizedTargetUserId,
            amount,
            reason
          };
    setIsLoading(true);
    setMessage(null);
    setPendingManualAdjustment(nextManualAdjustment);
    try {
      await createManualCoinTransaction(teamId, {
        id: nextManualAdjustment.id,
        user_id: normalizedTargetUserId,
        amount,
        reason,
        metadata: { source: "mobile_admin_adjustment" }
      });
      await refreshCoinData();
      setTargetUserId(normalizedTargetUserId);
      setPendingManualAdjustment(null);
      setMessage(t("coins.adjusted"));
    } catch (error) {
      setMessage(formatApiError(error, t));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSelectTransactionType(type: CoinTransactionType | null) {
    setTransactionType(type);
    if (!teamId) {
      return;
    }
    const transactionQuery = buildTransactionQuery(type);
    if (transactionQuery === null) {
      return;
    }
    setIsLoading(true);
    setMessage(null);
    setLoadState({ status: "loading" });
    try {
      setTransactions(await getMyCoinTransactions(teamId, transactionQuery));
      setLoadState({ status: "success" });
    } catch (error) {
      setLoadState({ status: "error", error });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>{t("coins.title")}</Text>
      {currentRole === "member" ? (
        <Pressable
          accessibilityRole="button"
          disabled={isLoading}
          onPress={handleLoadCoins}
          style={[styles.button, isLoading && styles.disabled]}
        >
          <Text style={styles.buttonText}>{t("coins.load")}</Text>
        </Pressable>
      ) : null}
      <ScreenState
        loadState={loadState}
        isLoading={isLoading}
        authRequiredLabel={t("common.authRequired")}
        loadingLabel={t("common.loading")}
        message={message}
        onRetry={handleLoadCoins}
        retryLabel={t("common.retry")}
        signInLabel={t("home.openLogin")}
      />
      {currentRole === "member" && balance != null ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t("coins.myBalance")}</Text>
          <Text style={styles.balance}>{balance}</Text>
        </View>
      ) : null}
      {currentRole === "member" ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t("coins.myTransactions")}</Text>
          <Text style={styles.muted}>{t("coins.filters")}</Text>
          <View style={styles.row}>
            {coinTransactionTypes.map((type) => (
              <Pressable
                accessibilityRole="button"
                disabled={isLoading}
                key={type ?? "all-my-coin-transactions"}
                onPress={() => handleSelectTransactionType(type)}
                style={[styles.pillButton, transactionType === type && styles.activeButton, isLoading && styles.disabled]}
              >
                <Text style={styles.secondaryText}>
                  {type === null ? t("coins.allTransactionTypes") : t(`coins.transaction.${type}`)}
                </Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.row}>
            <DateTimeField label={t("coins.createdAfter")} value={createdAfter} onChange={setCreatedAfter} disabled={isLoading} />
            <DateTimeField label={t("coins.createdBefore")} value={createdBefore} onChange={setCreatedBefore} disabled={isLoading} />
          </View>
          {isEmptyLoad(loadState, transactions.length) ? (
            <Text style={styles.muted}>{t("coins.noTransactions")}</Text>
          ) : (
            transactions.slice(0, 10).map((transaction) => (
              <View key={transaction.id} style={styles.transactionRow}>
                <Text style={styles.transactionAmount}>
                  {transaction.amount > 0 ? "+" : ""}
                  {transaction.amount}
                </Text>
                <View style={styles.transactionDetail}>
                  <Text style={styles.secondaryText}>{t(`coins.transaction.${transaction.type}`)}</Text>
                  <Text style={styles.muted}>
                    {transaction.reason ?? transaction.reference_type ?? t("coins.noReason")}
                  </Text>
                  <Text style={styles.muted}>{new Date(transaction.created_at).toLocaleString()}</Text>
                </View>
              </View>
            ))
          )}
        </View>
      ) : null}
      {currentRole === "member" && loadState.status === "success" ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t("coins.rules")}</Text>
          {defaultRuleInputs.map(({ trigger, labelKey }) => {
            const rule = selectEffectiveCoinRule(rules, trigger);
            return (
              <View key={trigger} style={styles.transactionRow}>
                <Text style={styles.secondaryText}>{t(labelKey)}</Text>
                <Text style={styles.secondaryText}>
                  {rule === null ? t("coins.ruleNotConfigured") : `${rule.amount} ${t("coins.unit")}`}
                </Text>
              </View>
            );
          })}
          <Text style={styles.muted}>{t("coins.signupRewardHint")}</Text>
        </View>
      ) : null}
      {canManageCoins
        ? defaultRuleInputs.map((ruleInput) => {
            const label = t(ruleInput.labelKey);
            return (
              <View key={ruleInput.trigger} style={styles.card}>
                <Text style={styles.cardTitle}>{label}</Text>
                <TextInput
                  autoCorrect={false}
                  keyboardType="number-pad"
                  onChangeText={(value) =>
                    setAmounts((currentAmounts) => ({ ...currentAmounts, [ruleInput.trigger]: value }))
                  }
                  placeholder={ruleInput.defaultAmount}
                  placeholderTextColor={colors.muted}
                  style={styles.input}
                  value={amounts[ruleInput.trigger]}
                />
                <Pressable
                  accessibilityRole="button"
                  disabled={isLoading}
                  onPress={() => handleSaveRule(ruleInput.trigger, label)}
                  style={[styles.secondaryButton, isLoading && styles.disabled]}
                >
                  <Text style={styles.secondaryText}>{t("coins.saveRule")}</Text>
                </Pressable>
              </View>
            );
          })
        : null}
      {canManageCoins ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t("coins.chooseMember")}</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setTargetUserId}
            placeholder={t("coins.memberUserId")}
            placeholderTextColor={colors.muted}
            style={styles.input}
            value={targetUserId}
          />
          {isEmptyLoad(loadState, members.length) ? <Text style={styles.muted}>{t("coins.noMembers")}</Text> : null}
          {members.map((membership) => (
            <Pressable
              accessibilityRole="button"
              disabled={isLoading}
              key={membership.user_id}
              onPress={() => setTargetUserId(membership.user_id)}
              style={[
                styles.memberButton,
                targetUserId === membership.user_id && styles.activeButton,
                isLoading && styles.disabled
              ]}
            >
              <View>
                <Text style={styles.secondaryText}>{membership.user?.name ?? membership.user_id}</Text>
                <Text style={styles.muted}>
                  {membership.jersey_number ? `#${membership.jersey_number} · ` : ""}
                  {membership.player_name ?? membership.user?.email ?? membership.user_id}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>
      ) : null}
      {canAdjustCoins ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t("coins.manualAdjustment")}</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setTargetUserId}
            placeholder={t("coins.memberUserId")}
            placeholderTextColor={colors.muted}
            style={styles.input}
            value={targetUserId}
          />
          <TextInput
            autoCorrect={false}
            keyboardType="numbers-and-punctuation"
            onChangeText={setAdjustAmount}
            placeholder={t("coins.adjustAmount")}
            placeholderTextColor={colors.muted}
            style={styles.input}
            value={adjustAmount}
          />
          <TextInput
            autoCorrect={false}
            onChangeText={setAdjustReason}
            placeholder={t("coins.adjustReason")}
            placeholderTextColor={colors.muted}
            style={styles.input}
            value={adjustReason}
          />
          <Pressable
            accessibilityRole="button"
            disabled={isLoading}
            onPress={handleManualAdjustment}
            style={[styles.secondaryButton, isLoading && styles.disabled]}
          >
            <Text style={styles.secondaryText}>{t("coins.createAdjustment")}</Text>
          </Pressable>
        </View>
      ) : null}
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
  balance: {
    color: colors.accent,
    fontSize: 34,
    fontWeight: "900"
  },
  transactionRow: {
    alignItems: "flex-start",
    backgroundColor: colors.background,
    borderRadius: 12,
    flexDirection: "row",
    gap: 12,
    padding: 12
  },
  transactionAmount: {
    color: colors.accent,
    fontSize: 18,
    fontWeight: "900",
    minWidth: 56
  },
  transactionDetail: {
    flex: 1,
    gap: 3
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
    flexWrap: "wrap",
    gap: 8
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
    paddingHorizontal: 10
  },
  secondaryButton: {
    alignItems: "center",
    backgroundColor: colors.background,
    borderRadius: 12,
    minHeight: 44,
    justifyContent: "center",
    marginTop: 4
  },
  memberButton: {
    backgroundColor: colors.background,
    borderRadius: 12,
    minHeight: 48,
    justifyContent: "center",
    padding: 12
  },
  activeButton: {
    backgroundColor: colors.accent
  },
  secondaryText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "700"
  },
  muted: {
    color: colors.muted,
    fontSize: 14
  },
  disabled: {
    opacity: 0.7
  },
  message: {
    color: colors.muted,
    fontSize: 14
  }
});
