import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { ScreenState } from "@/components/ScreenState";
import {
  createManualCoinTransaction,
  createCoinRule,
  getCoinBalance,
  getMemberCoinTransactions,
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
import { useI18n } from "@/lib/i18n/I18nProvider";
import type { TranslationKey } from "@/lib/i18n/translations";
import { generateClientUuid } from "@/lib/uuid";
import { colors } from "@/theme/colors";

type AttendanceCoinRuleTrigger = Exclude<CoinRuleTrigger, "manual">;

const defaultRuleInputs: Array<{
  trigger: AttendanceCoinRuleTrigger;
  labelKey: TranslationKey;
  defaultAmount: string;
}> = [
  { trigger: "training_attendance", labelKey: "coins.training", defaultAmount: "10" },
  { trigger: "match_attendance", labelKey: "coins.match", defaultAmount: "20" },
  { trigger: "late_attendance", labelKey: "coins.late", defaultAmount: "5" }
];

const coinTransactionTypes: Array<CoinTransactionType | null> = [
  null,
  "attendance_reward",
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
  const { teamId } = useLocalSearchParams<{ teamId: string }>();
  const { t } = useI18n();
  const [rules, setRules] = useState<CoinRule[]>([]);
  const [transactions, setTransactions] = useState<CoinTransaction[]>([]);
  const [memberTransactions, setMemberTransactions] = useState<CoinTransaction[]>([]);
  const [members, setMembers] = useState<Membership[]>([]);
  const [balance, setBalance] = useState<number | null>(null);
  const [amounts, setAmounts] = useState<Record<AttendanceCoinRuleTrigger, string>>({
    training_attendance: "10",
    match_attendance: "20",
    late_attendance: "5"
  });
  const [targetUserId, setTargetUserId] = useState("");
  const [adjustAmount, setAdjustAmount] = useState("10");
  const [adjustReason, setAdjustReason] = useState("");
  const [pendingManualAdjustment, setPendingManualAdjustment] = useState<PendingManualAdjustmentRequest | null>(null);
  const [transactionType, setTransactionType] = useState<CoinTransactionType | null>(null);
  const [memberTransactionType, setMemberTransactionType] = useState<CoinTransactionType | null>(null);
  const [createdAfter, setCreatedAfter] = useState("");
  const [createdBefore, setCreatedBefore] = useState("");
  const [currentRole, setCurrentRole] = useState<MembershipRole | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const canManageCoins = currentRole === "captain" || currentRole === "admin";
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
      return;
    }
    const transactionQuery = buildTransactionQuery(transactionType);
    if (transactionQuery === null) {
      return;
    }
    const [teamHome, nextBalance, nextTransactions] = await Promise.all([
      getTeamHome(teamId),
      getCoinBalance(teamId),
      getMyCoinTransactions(teamId, transactionQuery)
    ]);
    const nextRole = teamHome.current_membership.role;
    const canManageWithNextRole = nextRole === "captain" || nextRole === "admin";
    const [nextRules, nextMembers] = canManageWithNextRole
      ? await Promise.all([getCoinRules(teamId), getTeamMembers(teamId)])
      : [[], []];
    setCurrentRole(nextRole);
    setBalance(nextBalance.balance);
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
  }

  async function handleLoadCoins() {
    if (!teamId) {
      return;
    }
    setIsLoading(true);
    setMessage(null);
    try {
      await refreshCoinData();
    } catch (error) {
      setMessage(formatApiError(error, t));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    if (teamId) {
      void handleLoadCoins();
    }
  }, [teamId]);

  async function handleSaveRule(trigger: AttendanceCoinRuleTrigger, label: string) {
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
      const memberTransactionQuery = buildTransactionQuery(memberTransactionType);
      if (memberTransactionQuery !== null) {
        setMemberTransactions(await getMemberCoinTransactions(teamId, normalizedTargetUserId, memberTransactionQuery));
      }
      setMessage(t("coins.adjusted"));
    } catch (error) {
      setMessage(formatApiError(error, t));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleLoadMemberTransactions(userId = targetUserId) {
    if (!teamId) {
      return;
    }
    if (!canManageCoins) {
      setMessage(t("coins.captainOnlyHint"));
      return;
    }
    const normalizedUserId = normalizeCoinTargetUserId(userId);
    if (normalizedUserId === null) {
      setMessage(t("coins.invalidUserId"));
      return;
    }
    setIsLoading(true);
    setMessage(null);
    try {
      const memberTransactionQuery = buildTransactionQuery(memberTransactionType);
      if (memberTransactionQuery === null) {
        return;
      }
      setTargetUserId(normalizedUserId);
      setMemberTransactions(await getMemberCoinTransactions(teamId, normalizedUserId, memberTransactionQuery));
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
    try {
      setTransactions(await getMyCoinTransactions(teamId, transactionQuery));
    } catch (error) {
      setMessage(formatApiError(error, t));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSelectMemberTransactionType(type: CoinTransactionType | null) {
    setMemberTransactionType(type);
    if (!canManageCoins) {
      return;
    }
    if (!teamId || targetUserId.trim().length === 0) {
      return;
    }
    const normalizedUserId = normalizeCoinTargetUserId(targetUserId);
    if (normalizedUserId === null) {
      setMessage(t("coins.invalidUserId"));
      return;
    }
    const memberTransactionQuery = buildTransactionQuery(type);
    if (memberTransactionQuery === null) {
      return;
    }
    setIsLoading(true);
    setMessage(null);
    try {
      setTargetUserId(normalizedUserId);
      setMemberTransactions(await getMemberCoinTransactions(teamId, normalizedUserId, memberTransactionQuery));
    } catch (error) {
      setMessage(formatApiError(error, t));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>{t("coins.title")}</Text>
      <Text style={styles.muted}>{t("coins.captainOnlyHint")}</Text>
      <Pressable
        accessibilityRole="button"
        disabled={isLoading}
        onPress={handleLoadCoins}
        style={[styles.button, isLoading && styles.disabled]}
      >
        <Text style={styles.buttonText}>{t("coins.load")}</Text>
      </Pressable>
      <ScreenState
        isLoading={isLoading}
        authRequiredLabel={t("common.authRequired")}
        loadingLabel={t("common.loading")}
        message={message}
        onRetry={handleLoadCoins}
        retryLabel={t("common.retry")}
        signInLabel={t("home.openLogin")}
      />
      {balance != null ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t("coins.myBalance")}</Text>
          <Text style={styles.balance}>{balance}</Text>
        </View>
      ) : null}
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
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setCreatedAfter}
            placeholder={t("coins.createdAfter")}
            placeholderTextColor={colors.muted}
            style={[styles.input, styles.rowInput]}
            value={createdAfter}
          />
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setCreatedBefore}
            placeholder={t("coins.createdBefore")}
            placeholderTextColor={colors.muted}
            style={[styles.input, styles.rowInput]}
            value={createdBefore}
          />
        </View>
        {transactions.length === 0 ? (
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
      {!canManageCoins ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t("coins.rules")}</Text>
          <Text style={styles.muted}>{t("coins.captainOnlyHint")}</Text>
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
          {members.length === 0 ? <Text style={styles.muted}>{t("coins.noMembers")}</Text> : null}
          {members.map((membership) => (
            <Pressable
              accessibilityRole="button"
              disabled={isLoading}
              key={membership.user_id}
              onPress={() => handleLoadMemberTransactions(membership.user_id)}
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
                  {membership.position ?? membership.user?.email ?? membership.user_id}
                </Text>
              </View>
            </Pressable>
          ))}
          <Pressable
            accessibilityRole="button"
            disabled={isLoading}
            onPress={() => handleLoadMemberTransactions()}
            style={[styles.secondaryButton, isLoading && styles.disabled]}
          >
            <Text style={styles.secondaryText}>{t("coins.loadMemberTransactions")}</Text>
          </Pressable>
          {!canAdjustCoins ? <Text style={styles.muted}>{t("coins.adminOnlyHint")}</Text> : null}
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
      {canManageCoins ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t("coins.memberTransactions")}</Text>
        <Text style={styles.muted}>{t("coins.filters")}</Text>
        <View style={styles.row}>
          {coinTransactionTypes.map((type) => (
            <Pressable
              accessibilityRole="button"
              disabled={isLoading}
              key={type ?? "all-member-coin-transactions"}
              onPress={() => handleSelectMemberTransactionType(type)}
              style={[
                styles.pillButton,
                memberTransactionType === type && styles.activeButton,
                isLoading && styles.disabled
              ]}
            >
              <Text style={styles.secondaryText}>
                {type === null ? t("coins.allTransactionTypes") : t(`coins.transaction.${type}`)}
              </Text>
            </Pressable>
          ))}
        </View>
        {memberTransactions.length === 0 ? (
          <Text style={styles.muted}>{t("coins.noMemberTransactions")}</Text>
        ) : (
          memberTransactions.slice(0, 10).map((transaction) => (
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
  balance: {
    color: colors.accent,
    fontSize: 34,
    fontWeight: "900"
  },
  transactionRow: {
    alignItems: "flex-start",
    backgroundColor: colors.background,
    borderRadius: 8,
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
    borderRadius: 8,
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
    borderRadius: 8,
    minHeight: 44,
    justifyContent: "center",
    marginTop: 4
  },
  memberButton: {
    backgroundColor: colors.background,
    borderRadius: 8,
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
