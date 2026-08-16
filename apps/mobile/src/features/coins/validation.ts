import type { CoinRule, CoinRuleTrigger } from "./api";

type SelectableCoinRule = Pick<CoinRule, "trigger_type" | "is_active" | "updated_at" | "created_at">;

export function parseCoinAmount(value: string) {
  const normalizedValue = value.trim();
  if (!/^-?\d+$/.test(normalizedValue)) {
    return null;
  }
  const amount = Number.parseInt(normalizedValue, 10);
  return Number.isNaN(amount) ? null : amount;
}

export function parseCoinRuleAmount(value: string) {
  const amount = parseCoinAmount(value);
  return amount !== null && amount >= 0 ? amount : null;
}

export function parseManualCoinAmount(value: string) {
  const amount = parseCoinAmount(value);
  return amount !== null && amount !== 0 ? amount : null;
}

export function normalizeCoinTargetUserId(value: string) {
  const normalizedValue = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    normalizedValue
  )
    ? normalizedValue
    : null;
}

export function normalizeCoinReason(value: string) {
  const normalizedValue = value.trim();
  return normalizedValue.length > 0 ? normalizedValue : null;
}

export function selectEffectiveCoinRule<TCoinRule extends SelectableCoinRule>(
  rules: TCoinRule[],
  triggerType: Exclude<CoinRuleTrigger, "manual">
) {
  return (
    rules
      .filter((rule) => rule.trigger_type === triggerType && rule.is_active)
      .sort((left, right) => {
        const updatedComparison = right.updated_at.localeCompare(left.updated_at);
        return updatedComparison !== 0 ? updatedComparison : right.created_at.localeCompare(left.created_at);
      })[0] ?? null
  );
}
